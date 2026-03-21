/**
 * Cron interface — runs agent jobs on a cron schedule.
 *
 * Each job has a name, schedule (cron expression), prompt, and optional
 * agent override (a recipe path or partial agent config merged with base).
 *
 * Observability:
 *   - App-level tracer: `cron.scheduler` span wraps the full lifecycle,
 *     `cron.job` span wraps each individual execution.
 *   - App-level logger: scheduler lifecycle events (starting, stopping,
 *     job scheduled/completed/failed/rescheduled).
 *   - Per-job session logger: detailed execution logs written to the
 *     job's own session directory ({dataDir}/sessions/{id}/logs.jsonl).
 */
import { CronExpressionParser } from 'cron-parser'
import { AgentLoop, mergeMiddleware, type StreamChunkContext, type MiddlewareConfig } from '@chinmaymk/ra'
import type { AppContext } from '../bootstrap'
import type { CronJob, AgentConfig } from '../config/types'
import { buildMessagePrefix } from './messages'
import { createSessionMiddleware } from '../agent/session'

export interface CronRunnerOptions {
  app: AppContext
  jobs: CronJob[]
  /** Called when a job starts. */
  onJobStart?: (job: CronJob) => void
  /** Called when a job completes (successfully or with error). */
  onJobEnd?: (job: CronJob, result: { ok: boolean; error?: string }) => void
  /** Abort signal to stop the scheduler. */
  signal?: AbortSignal
  /** When true, all jobs run immediately on startup before switching to cron schedule. */
  runImmediately?: boolean
}

interface ScheduledJob {
  job: CronJob
  nextRun: Date
  agentConfig: Partial<AgentConfig> | undefined
}

/** Resolve a cron job's agent override into a partial AgentConfig. */
async function resolveJobAgent(
  job: CronJob,
  configDir: string,
): Promise<Partial<AgentConfig> | undefined> {
  if (!job.agent) return undefined

  // String → load as recipe YAML file
  if (typeof job.agent === 'string') {
    const { join, isAbsolute } = await import('path')
    const path = isAbsolute(job.agent) ? job.agent : join(configDir, job.agent)
    const yaml = await import('js-yaml')
    const content = await Bun.file(path).text()
    const parsed = yaml.load(content) as Record<string, unknown>
    return (parsed.agent ?? parsed) as Partial<AgentConfig>
  }

  // Object → use directly as partial agent config
  return job.agent
}

/** Compute next run date from a cron expression. */
function nextRunDate(schedule: string): Date {
  return CronExpressionParser.parse(schedule).next().toDate()
}

/** Merge base agent config with per-job overrides, returning resolved loop options. */
function resolveJobConfig(baseCfg: AgentConfig, overrides: Partial<AgentConfig> | undefined) {
  return {
    model: overrides?.model ?? baseCfg.model,
    maxIterations: overrides?.maxIterations ?? baseCfg.maxIterations,
    maxRetries: overrides?.maxRetries ?? baseCfg.maxRetries,
    toolTimeout: overrides?.toolTimeout ?? baseCfg.toolTimeout,
    thinking: overrides?.thinking ?? baseCfg.thinking,
    maxToolResponseSize: overrides?.tools?.maxResponseSize ?? baseCfg.tools.maxResponseSize,
    compaction: overrides?.compaction
      ? { ...baseCfg.compaction, ...overrides.compaction }
      : baseCfg.compaction,
  }
}

/** Run a single cron job with full logging and tracing. */
async function executeJob(
  job: CronJob,
  app: AppContext,
  jobAgentConfig: Partial<AgentConfig> | undefined,
): Promise<void> {
  const { config, logger, tracer } = app
  const jobCfg = resolveJobConfig(config.agent, jobAgentConfig)

  const jobSpan = tracer.startSpan('cron.job', {
    job: job.name,
    schedule: job.schedule,
  })

  logger.info('cron job executing', {
    job: job.name,
    model: jobCfg.model,
    maxIterations: jobCfg.maxIterations,
    promptLength: job.prompt.length,
  })

  const initialMessages = buildMessagePrefix({
    systemPrompt: config.agent.systemPrompt,
    skillMap: app.skillMap,
    contextMessages: app.contextMessages,
    activeSkillNames: config.app.skills,
  })
  initialMessages.push({ role: 'user', content: job.prompt })

  const session = await app.storage.create({
    provider: config.agent.provider,
    model: jobCfg.model,
    interface: 'cron',
  })

  logger.info('cron job session created', {
    job: job.name,
    sessionId: session.id,
  })

  const loopSession = createSessionMiddleware(app.middleware, {
    storage: app.storage,
    sessionId: session.id,
    priorCount: initialMessages.length - 1,
    logsEnabled: config.app.logsEnabled,
    logLevel: config.app.logLevel,
    tracesEnabled: config.app.tracesEnabled,
    logger,
  })

  loopSession.logger.info('cron job started', {
    job: job.name,
    schedule: job.schedule,
    sessionId: session.id,
    model: jobCfg.model,
  })

  const stderrHook: Partial<MiddlewareConfig> = {
    onStreamChunk: [async (ctx: StreamChunkContext) => {
      if (ctx.chunk.type === 'text') {
        process.stderr.write(ctx.chunk.delta)
      }
    }],
  }

  const loop = new AgentLoop({
    provider: app.provider,
    tools: app.tools,
    sessionId: session.id,
    logger: loopSession.logger,
    middleware: mergeMiddleware(stderrHook, loopSession.middleware),
    ...jobCfg,
  })

  try {
    const result = await loop.run(initialMessages)

    const usage = {
      iterations: result.iterations,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      messageCount: result.messages.length,
    }

    loopSession.logger.info('cron job finished', { job: job.name, ...usage })
    tracer.endSpan(jobSpan, 'ok', { sessionId: session.id, ...usage })
    logger.info('cron job completed', { job: job.name, sessionId: session.id, ...usage })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)

    loopSession.logger.error('cron job failed', { job: job.name, error })
    logger.error('cron job failed', { job: job.name, sessionId: session.id, error })
    tracer.endSpan(jobSpan, 'error', { sessionId: session.id, error })

    await loopSession.logger.flush()
    throw err
  }

  await loopSession.logger.flush()
}

/** Start the cron scheduler. Runs until the signal is aborted. */
export async function runCron(options: CronRunnerOptions): Promise<void> {
  const { app, jobs, onJobStart, onJobEnd, signal, runImmediately } = options
  const { logger, tracer } = app

  if (jobs.length === 0) {
    logger.warn('no cron jobs configured')
    return
  }

  const schedulerSpan = tracer.startSpan('cron.scheduler', {
    jobCount: jobs.length,
    jobNames: jobs.map(j => j.name),
  })

  logger.info('cron scheduler starting', {
    jobCount: jobs.length,
    jobs: jobs.map(j => ({ name: j.name, schedule: j.schedule })),
  })

  const scheduled: ScheduledJob[] = []
  for (const job of jobs) {
    try {
      CronExpressionParser.parse(job.schedule)
    } catch (err) {
      logger.error('invalid cron expression', {
        job: job.name,
        schedule: job.schedule,
        error: String(err),
      })
      continue
    }

    const agentConfig = await resolveJobAgent(job, app.config.app.configDir)
    const nextRun = runImmediately ? new Date() : nextRunDate(job.schedule)
    scheduled.push({ job, nextRun, agentConfig })

    logger.info('cron job scheduled', {
      job: job.name,
      schedule: job.schedule,
      nextRun: nextRun.toISOString(),
      hasAgentOverride: !!agentConfig,
    })
  }

  if (scheduled.length === 0) {
    logger.error('no valid cron jobs to schedule')
    tracer.endSpan(schedulerSpan, 'error', { reason: 'no_valid_jobs' })
    return
  }

  process.stderr.write(`Cron scheduler started with ${scheduled.length} job(s)\n`)
  for (const s of scheduled) {
    process.stderr.write(`  ${s.job.name}: ${s.job.schedule} → next: ${s.nextRun.toISOString()}\n`)
  }

  let jobsRun = 0
  let jobsFailed = 0

  while (!signal?.aborted) {
    scheduled.sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime())
    const next = scheduled[0]!
    const delay = Math.max(0, next.nextRun.getTime() - Date.now())

    if (delay > 0) {
      logger.debug('cron scheduler sleeping', {
        nextJob: next.job.name,
        delayMs: delay,
        nextRun: next.nextRun.toISOString(),
      })
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      })
    }

    if (signal?.aborted) break

    const { job, agentConfig } = next
    logger.info('cron job starting', { job: job.name, schedule: job.schedule })
    onJobStart?.(job)

    try {
      await executeJob(job, app, agentConfig)
      jobsRun++
      onJobEnd?.(job, { ok: true })
    } catch (err) {
      jobsRun++
      jobsFailed++
      const error = err instanceof Error ? err.message : String(err)
      onJobEnd?.(job, { ok: false, error })
    }

    await logger.flush()
    await tracer.flush()

    next.nextRun = nextRunDate(job.schedule)
    logger.info('cron job rescheduled', {
      job: job.name,
      nextRun: next.nextRun.toISOString(),
    })
  }

  tracer.endSpan(schedulerSpan, 'ok', {
    jobsRun,
    jobsFailed,
    stoppedBySignal: signal?.aborted ?? false,
  })

  logger.info('cron scheduler stopped', { jobsRun, jobsFailed })
  await logger.flush()
  await tracer.flush()
}
