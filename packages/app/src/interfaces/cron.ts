/**
 * Cron interface — runs agent jobs on a cron schedule.
 *
 * Each job has a name, schedule (cron expression), prompt, and optional
 * agent override (a recipe path or partial agent config merged with base).
 */
import { CronExpressionParser } from 'cron-parser'
import { AgentLoop, mergeMiddleware, type IMessage, type StreamChunkContext, type MiddlewareConfig } from '@chinmaymk/ra'
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

/** Run a single cron job. */
async function executeJob(
  job: CronJob,
  app: AppContext,
  jobAgentConfig: Partial<AgentConfig> | undefined,
): Promise<void> {
  const { config } = app
  const agentCfg = config.agent

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

  // Build initial messages
  const initialMessages = buildMessagePrefix({
    systemPrompt: agentCfg.systemPrompt,
    skillMap: app.skillMap,
    contextMessages: app.contextMessages,
    activeSkillNames: config.app.skills,
  })
  initialMessages.push({ role: 'user', content: job.prompt })

  // Create a session for this job run
  const session = await app.storage.create({
    provider: agentCfg.provider,
    model,
    interface: 'cron',
  })

  const loopSession = createSessionMiddleware(app.middleware, {
    storage: app.storage,
    sessionId: session.id,
    priorCount: initialMessages.length - 1,
    logsEnabled: config.app.logsEnabled,
    logLevel: config.app.logLevel,
    tracesEnabled: config.app.tracesEnabled,
    logger: app.logger,
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

  await loop.run(initialMessages)
}

/** Start the cron scheduler. Runs until the signal is aborted. */
export async function runCron(options: CronRunnerOptions): Promise<void> {
  const { app, jobs, onJobStart, onJobEnd, signal, runImmediately } = options
  const configDir = app.config.app.configDir

  if (jobs.length === 0) {
    app.logger.warn('no cron jobs configured')
    return
  }

  // Validate and resolve all jobs
  const scheduled: ScheduledJob[] = []
  for (const job of jobs) {
    try {
      CronExpressionParser.parse(job.schedule) // validate expression
    } catch (err) {
      app.logger.error('invalid cron expression', { job: job.name, schedule: job.schedule, error: String(err) })
      continue
    }

    const agentConfig = await resolveJobAgent(job, configDir)
    scheduled.push({
      job,
      nextRun: runImmediately ? new Date() : nextRunDate(job.schedule),
      agentConfig,
    })

    app.logger.info('cron job scheduled', { name: job.name, schedule: job.schedule, nextRun: nextRunDate(job.schedule).toISOString() })
  }

  if (scheduled.length === 0) {
    app.logger.error('no valid cron jobs to schedule')
    return
  }

  process.stderr.write(`Cron scheduler started with ${scheduled.length} job(s)\n`)
  for (const s of scheduled) {
    process.stderr.write(`  ${s.job.name}: ${s.job.schedule} → next: ${s.nextRun.toISOString()}\n`)
  }

  // Main scheduler loop
  while (!signal?.aborted) {
    // Find the next job to run
    scheduled.sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime())
    const next = scheduled[0]!
    const now = Date.now()
    const delay = Math.max(0, next.nextRun.getTime() - now)

    if (delay > 0) {
      // Sleep until next job is due (or signal aborts)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
      })
    }

    if (signal?.aborted) break

    // Execute the job
    const { job, agentConfig } = next
    app.logger.info('cron job starting', { name: job.name })
    onJobStart?.(job)

    try {
      await executeJob(job, app, agentConfig)
      app.logger.info('cron job completed', { name: job.name })
      onJobEnd?.(job, { ok: true })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      app.logger.error('cron job failed', { name: job.name, error: errorMsg })
      onJobEnd?.(job, { ok: false, error: errorMsg })
    }

    // Schedule next run for this job
    next.nextRun = nextRunDate(job.schedule)
    app.logger.info('cron job rescheduled', { name: job.name, nextRun: next.nextRun.toISOString() })
  }

  app.logger.info('cron scheduler stopped')
}
