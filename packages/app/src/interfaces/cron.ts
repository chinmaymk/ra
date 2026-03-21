import {
  AgentLoop,
  mergeMiddleware,
  errorMessage,
  type IMessage,
} from '@chinmaymk/ra'
import { Cron } from 'croner'
import { writeFile, readFile, unlink } from 'node:fs/promises'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { CronJobConfig, AgentConfig, RaConfig } from '../config/types'
import type { AppContext } from '../bootstrap'
import { bootstrap } from '../bootstrap'
import { createSessionMiddleware } from '../agent/session'
import { buildMessagePrefix } from './messages'

/** Fields that, when overridden on a job, require a separate bootstrap. */
const BOOTSTRAP_FIELDS: (keyof AgentConfig)[] = ['provider', 'providers', 'tools', 'mcp', 'memory', 'middleware', 'permissions']

export interface CronSchedulerOptions {
  /** Base application context — shared by jobs that don't override bootstrap-level fields. */
  app: AppContext
  /** Maximum concurrent job executions. Falls back to app.config.maxConcurrency. */
  maxConcurrency?: number
}

/**
 * Cron interface — long-running process that executes agent loops on configurable schedules.
 * Each job can override any agent-relevant RaConfig field inline. Jobs that override
 * bootstrap-level fields (provider, tools, mcp, etc.) get their own independently
 * bootstrapped AppContext; simple jobs share the base context.
 */
export class CronScheduler {
  private app: AppContext
  private maxConcurrency: number
  private cronInstances: Cron[] = []
  private runningJobs = new Map<string, AgentLoop>()
  private queuedJobs = new Set<string>()
  private activeCount = 0
  private lockPath: string
  private stopped = false

  /** Per-job AppContext. Jobs needing their own bootstrap are cached here. */
  private jobContexts = new Map<string, AppContext>()

  constructor(options: CronSchedulerOptions) {
    this.app = options.app
    this.maxConcurrency = options.maxConcurrency ?? options.app.config.maxConcurrency
    this.lockPath = join(options.app.config.dataDir, 'cron.lock')
  }

  get jobs(): CronJobConfig[] {
    return this.app.config.cron.jobs
  }

  async start(): Promise<void> {
    const enabledJobs = this.jobs.filter(j => j.enabled !== false)
    if (enabledJobs.length === 0) {
      throw new Error('cron: no enabled jobs configured')
    }

    // Validate
    const ids = new Set<string>()
    for (const job of enabledJobs) {
      if (!job.id) throw new Error('cron: every job must have an id')
      if (!job.schedule) throw new Error(`cron: job "${job.id}" missing schedule`)
      if (!job.prompt) throw new Error(`cron: job "${job.id}" missing prompt`)
      if (ids.has(job.id)) throw new Error(`cron: duplicate job id "${job.id}"`)
      ids.add(job.id)
    }

    // Acquire lock
    await this.acquireLock()

    // Bootstrap per-job contexts for jobs that override bootstrap-level fields
    for (const job of enabledJobs) {
      if (this.needsOwnContext(job)) {
        this.app.logger.info('cron: bootstrapping per-job context', { jobId: job.id })
        const mergedConfig = this.mergeJobConfig(job)
        const ctx = await bootstrap(mergedConfig, { skipSession: true })
        this.jobContexts.set(job.id, ctx)
      }
    }

    // Schedule each job
    for (const job of enabledJobs) {
      const cron = new Cron(job.schedule, { timezone: job.timezone }, () => {
        this.executeJob(job).catch(err => {
          this.app.logger.error('cron: unhandled error in job execution', {
            jobId: job.id,
            error: errorMessage(err),
          })
        })
      })
      this.cronInstances.push(cron)

      const ctx = this.contextFor(job)
      this.app.logger.info('cron: job scheduled', {
        jobId: job.id,
        schedule: job.schedule,
        timezone: job.timezone,
        provider: ctx.config.provider,
        model: job.model ?? ctx.config.model,
        nextRun: cron.nextRun()?.toISOString(),
      })
    }
  }

  async stop(): Promise<void> {
    this.stopped = true

    // Stop all cron timers
    for (const cron of this.cronInstances) {
      cron.stop()
    }
    this.cronInstances = []

    // Abort all running loops
    for (const [jobId, loop] of this.runningJobs) {
      this.app.logger.info('cron: aborting running job', { jobId })
      loop.abort()
    }

    // Shutdown per-job contexts
    for (const [, ctx] of this.jobContexts) {
      try { await ctx.shutdown() } catch { /* best-effort */ }
    }
    this.jobContexts.clear()

    // Release lock
    await this.releaseLock()
  }

  private async executeJob(job: CronJobConfig): Promise<void> {
    if (this.stopped) return

    // Overlap check
    if (this.runningJobs.has(job.id)) {
      if (job.overlapPolicy === 'queue') {
        if (!this.queuedJobs.has(job.id)) {
          this.app.logger.info('cron: job queued (already running)', { jobId: job.id })
          this.queuedJobs.add(job.id)
        }
      } else {
        this.app.logger.info('cron: job skipped (already running)', { jobId: job.id })
      }
      return
    }

    // Concurrency check
    if (this.activeCount >= this.maxConcurrency) {
      this.app.logger.info('cron: job skipped (concurrency limit)', {
        jobId: job.id,
        activeCount: this.activeCount,
        maxConcurrency: this.maxConcurrency,
      })
      return
    }

    const ctx = this.contextFor(job)
    const model = job.model ?? ctx.config.model
    const maxIterations = job.maxIterations ?? ctx.config.maxIterations

    this.activeCount++
    this.app.logger.info('cron: job started', { jobId: job.id, model })

    try {
      // Session
      const sessionId = await this.ensureSession(job, ctx)

      // Build messages
      const prefix = buildMessagePrefix({
        systemPrompt: job.systemPrompt ?? ctx.config.systemPrompt,
        skillMap: ctx.skillMap,
        contextMessages: ctx.contextMessages,
        activeSkillNames: job.skills ?? ctx.config.skills,
      })
      const priorCount = prefix.length

      // For persistent sessions, prepend stored history
      const messages: IMessage[] = [...prefix]
      if (job.persistent) {
        const history = await ctx.storage.readMessages(sessionId)
        messages.push(...history)
      }
      messages.push({ role: 'user', content: job.prompt })

      // Create loop
      const session = createSessionMiddleware(ctx.middleware, {
        storage: ctx.storage,
        sessionId,
        priorCount,
        logsEnabled: job.logsEnabled ?? ctx.config.logsEnabled,
        logLevel: job.logLevel ?? ctx.config.logLevel,
        tracesEnabled: job.tracesEnabled ?? ctx.config.tracesEnabled,
        logger: ctx.logger,
      })

      const loop = new AgentLoop({
        provider: ctx.provider,
        tools: ctx.tools,
        model,
        middleware: mergeMiddleware(session.middleware),
        maxIterations,
        maxRetries: job.maxRetries ?? ctx.config.maxRetries,
        toolTimeout: job.toolTimeout ?? ctx.config.toolTimeout,
        maxToolResponseSize: ctx.config.tools.maxResponseSize,
        sessionId,
        thinking: job.thinking ?? ctx.config.thinking,
        compaction: job.compaction ?? ctx.config.compaction,
        logger: session.logger,
      })

      this.runningJobs.set(job.id, loop)

      const result = await loop.run(messages)
      this.app.logger.info('cron: job completed', {
        jobId: job.id,
        iterations: result.iterations,
        stopReason: result.stopReason,
        usage: result.usage,
      })
    } catch (err) {
      this.app.logger.error('cron: job failed', {
        jobId: job.id,
        error: errorMessage(err),
      })
    } finally {
      this.runningJobs.delete(job.id)
      this.activeCount--

      // Execute queued run if any
      if (this.queuedJobs.has(job.id)) {
        this.queuedJobs.delete(job.id)
        this.executeJob(job).catch(err => {
          this.app.logger.error('cron: queued job execution failed', {
            jobId: job.id,
            error: errorMessage(err),
          })
        })
      }
    }
  }

  /** Get the AppContext for a job — per-job if bootstrapped, otherwise base. */
  private contextFor(job: CronJobConfig): AppContext {
    return this.jobContexts.get(job.id) ?? this.app
  }

  /** Check whether a job overrides fields that require a separate bootstrap. */
  private needsOwnContext(job: CronJobConfig): boolean {
    const jobRecord = job as unknown as Record<string, unknown>
    return BOOTSTRAP_FIELDS.some(field => jobRecord[field] !== undefined)
  }

  /** Deep-merge job's RaConfig overrides onto the base config. */
  private mergeJobConfig(job: CronJobConfig): RaConfig {
    const base = this.app.config
    return {
      ...base,
      ...(job.provider !== undefined && { provider: job.provider }),
      ...(job.model !== undefined && { model: job.model }),
      ...(job.systemPrompt !== undefined && { systemPrompt: job.systemPrompt }),
      ...(job.maxIterations !== undefined && { maxIterations: job.maxIterations }),
      ...(job.maxRetries !== undefined && { maxRetries: job.maxRetries }),
      ...(job.toolTimeout !== undefined && { toolTimeout: job.toolTimeout }),
      ...(job.thinking !== undefined && { thinking: job.thinking }),
      ...(job.tools !== undefined && { tools: { ...base.tools, ...job.tools } }),
      ...(job.providers !== undefined && { providers: { ...base.providers, ...job.providers } }),
      ...(job.mcp !== undefined && { mcp: { ...base.mcp, ...job.mcp } }),
      ...(job.middleware !== undefined && { middleware: { ...base.middleware, ...job.middleware } }),
      ...(job.memory !== undefined && { memory: { ...base.memory, ...job.memory } }),
      ...(job.compaction !== undefined && { compaction: { ...base.compaction, ...job.compaction } }),
      ...(job.skills !== undefined && { skills: job.skills }),
      ...(job.skillDirs !== undefined && { skillDirs: job.skillDirs }),
      ...(job.permissions !== undefined && { permissions: { ...base.permissions, ...job.permissions } }),
      ...(job.context !== undefined && { context: { ...base.context, ...job.context } }),
      // Force interface to cron
      interface: 'cron',
    }
  }

  private async ensureSession(job: CronJobConfig, ctx: AppContext): Promise<string> {
    if (job.persistent) {
      const deterministicId = `cron-${job.id}`
      return ctx.storage.ensureSession(deterministicId, {
        provider: ctx.provider.name,
        model: job.model ?? ctx.config.model,
        interface: 'cron',
      })
    }
    const session = await ctx.storage.create({
      provider: ctx.provider.name,
      model: job.model ?? ctx.config.model,
      interface: 'cron',
    })
    return session.id
  }

  // ── Lock file management ──────────────────────────────────────────

  private async acquireLock(): Promise<void> {
    try {
      const content = await readFile(this.lockPath, 'utf-8')
      const lock = JSON.parse(content) as { pid: number; startedAt: string }
      if (this.isProcessAlive(lock.pid)) {
        throw new Error(`cron: scheduler already running (pid: ${lock.pid}, started: ${lock.startedAt})`)
      }
      this.app.logger.info('cron: removing stale lock', { stalePid: lock.pid })
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('cron: scheduler already running')) throw err
      // File doesn't exist or is invalid — proceed
    }

    await writeFile(this.lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))

    // Clean up on exit
    const cleanup = () => {
      try { unlinkSync(this.lockPath) } catch { /* best-effort */ }
    }
    process.on('exit', cleanup)
    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  }

  private async releaseLock(): Promise<void> {
    try { await unlink(this.lockPath) } catch { /* best-effort */ }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
}
