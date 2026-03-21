/**
 * Cron interface — runs agent jobs on a cron schedule.
 *
 * Each job has a name, schedule (cron expression), prompt, and optional
 * agent override (a recipe path or partial agent config merged with base).
 */
import { CronExpressionParser } from 'cron-parser'
import { AgentLoop, mergeMiddleware, type StreamChunkContext, type MiddlewareConfig, type Logger } from '@chinmaymk/ra'
import type { AppContext } from '../bootstrap'
import type { CronJob, AgentConfig } from '../config/types'
import { buildMessagePrefix } from './messages'
import { createSessionMiddleware } from '../agent/session'

export interface CronRunnerOptions {
  app: AppContext
  jobs: CronJob[]
  /** Called when a job starts. */
  onJobStart?: (job: CronJob) => void
  /** Called when a job completes. */
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
    // A recipe file has { agent: {...} } or is a flat agent config
    return (parsed.agent ?? parsed) as Partial<AgentConfig>
  }

  // Object → partial agent config
  return job.agent
}

/** Compute next run date from a cron expression. */
function nextRunDate(schedule: string): Date {
  const interval = CronExpressionParser.parse(schedule)
  return interval.next().toDate()
}

/** Run a single cron job with full logging and tracing. */
async function executeJob(
  job: CronJob,
  app: AppContext,
  jobAgentConfig: Partial<AgentConfig> | undefined,
): Promise<void> {
  const { config, logger, tracer } = app
  const agentCfg = config.agent

  // App-level tracer span wrapping the entire job execution
  const jobSpan = tracer.startSpan('cron.job', {
    job: job.name,
    schedule: job.schedule,
  })

  // Merge base agent config with job-specific overrides
  const model = jobAgentConfig?.model ?? agentCfg.model
  const maxIterations = jobAgentConfig?.maxIterations ?? agentCfg.maxIterations
  const maxRetries = jobAgentConfig?.maxRetries ?? agentCfg.maxRetries
  const toolTimeout = jobAgentConfig?.toolTimeout ?? agentCfg.toolTimeout
  const thinking = jobAgentConfig?.thinking ?? agentCfg.thinking
  const compaction = jobAgentConfig?.compaction
    ? { ...agentCfg.compaction, ...jobAgentConfig.compaction }
    : agentCfg.compaction
  const maxToolResponseSize = jobAgentConfig?.tools?.maxResponseSize ?? agentCfg.tools.maxResponseSize

  logger.info('cron job executing', {
    job: job.name,
    model,
    maxIterations,
    promptLength: job.prompt.length,
  })

  // Build initial messages
  const initialMessages = buildMessagePrefix({
    systemPrompt: agentCfg.systemPrompt,
    skillMap: app.skillMap,
    contextMessages: app.contextMessages,
    activeSkillNames: config.app.skills,
  })
  initialMessages.push({ role: 'user', content: job.prompt })

  // Create a per-job session for isolated log/trace output
  const session = await app.storage.create({
    provider: agentCfg.provider,
    model,
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

  // Log the cron job name into the per-session logger so each log line
  // includes context about which job produced it
  loopSession.logger.info('cron job started', {
    job: job.name,
    schedule: job.schedule,
    sessionId: session.id,
    model,
  })

  const logHook: Partial<MiddlewareConfig> = {
    onStreamChunk: [async (ctx: StreamChunkContext) => {
      if (ctx.chunk.type === 'text') {
        process.stderr.write(ctx.chunk.delta)
      }
    }],
  }

  const loop = new AgentLoop({
    provider: app.provider,
    tools: app.tools,
    model,
    maxIterations,
    maxRetries,
    toolTimeout,
    maxToolResponseSize,
    thinking,
    compaction,
    sessionId: session.id,
    logger: loopSession.logger,
    middleware: mergeMiddleware(logHook, loopSession.middleware),
  })

  try {
    const result = await loop.run(initialMessages)

    loopSession.logger.info('cron job finished', {
      job: job.name,
      iterations: result.iterations,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      messageCount: result.messages.length,
    })

    tracer.endSpan(jobSpan, 'ok', {
      sessionId: session.id,
      iterations: result.iterations,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      messageCount: result.messages.length,
    })

    logger.info('cron job completed', {
      job: job.name,
      sessionId: session.id,
      iterations: result.iterations,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    loopSession.logger.error('cron job failed', {
      job: job.name,
      error: errorMsg,
    })

    logger.error('cron job failed', {
      job: job.name,
      sessionId: session.id,
      error: errorMsg,
    })

    tracer.endSpan(jobSpan, 'error', {
      sessionId: session.id,
      error: errorMsg,
    })

    // Ensure per-job logger/tracer flush even on error paths
    // that bypass the afterLoopComplete middleware hook
    await flushSessionLogger(loopSession.logger)

    throw err
  }

  // Flush per-job logger/tracer after successful completion
  await flushSessionLogger(loopSession.logger)
}

/** Flush the per-session logger created by createSessionMiddleware. */
async function flushSessionLogger(sessionLogger: Logger): Promise<void> {
  await sessionLogger.flush()
}

/** Start the cron scheduler. Runs until the signal is aborted. */
export async function runCron(options: CronRunnerOptions): Promise<void> {
  const { app, jobs, onJobStart, onJobEnd, signal, runImmediately } = options
  const { logger, tracer } = app
  const configDir = app.config.app.configDir

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

  // Validate and resolve all jobs
  const scheduled: ScheduledJob[] = []
  for (const job of jobs) {
    try {
      CronExpressionParser.parse(job.schedule) // validate expression
    } catch (err) {
      logger.error('invalid cron expression', { job: job.name, schedule: job.schedule, error: String(err) })
      continue
    }

    const agentConfig = await resolveJobAgent(job, configDir)
    const nextRun = runImmediately ? new Date() : nextRunDate(job.schedule)
    scheduled.push({ job, nextRun, agentConfig })

    logger.info('cron job scheduled', {
      name: job.name,
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

  // Main scheduler loop
  while (!signal?.aborted) {
    // Find the next job to run
    scheduled.sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime())
    const next = scheduled[0]!
    const now = Date.now()
    const delay = Math.max(0, next.nextRun.getTime() - now)

    if (delay > 0) {
      logger.debug('cron scheduler sleeping', {
        nextJob: next.job.name,
        delayMs: delay,
        nextRun: next.nextRun.toISOString(),
      })
      // Sleep until next job is due (or signal aborts)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      })
    }

    if (signal?.aborted) break

    // Execute the job
    const { job, agentConfig } = next
    logger.info('cron job starting', { name: job.name, schedule: job.schedule })
    onJobStart?.(job)

    try {
      await executeJob(job, app, agentConfig)
      jobsRun++
      onJobEnd?.(job, { ok: true })
    } catch (err) {
      jobsRun++
      jobsFailed++
      const errorMsg = err instanceof Error ? err.message : String(err)
      onJobEnd?.(job, { ok: false, error: errorMsg })
    }

    // Flush app-level logger/tracer after each job
    await logger.flush()
    await tracer.flush()

    // Schedule next run for this job
    next.nextRun = nextRunDate(job.schedule)
    logger.info('cron job rescheduled', { name: job.name, nextRun: next.nextRun.toISOString() })
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
