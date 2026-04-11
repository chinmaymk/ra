import { describe, it, expect } from 'bun:test'
import { runCron } from '../../src/interfaces/cron'
import { ToolRegistry } from '@chinmaymk/ra'
import type { IProvider } from '@chinmaymk/ra'
import type { AppContext } from '../../src/bootstrap'
import type { RaConfig, CronJob } from '../../src/config/types'
import { makeStorage } from '../fixtures'
import { tmpdir } from '../tmpdir'


interface LogRecord {
  level: string
  message: string
  data?: Record<string, unknown>
}

interface SpanRecord {
  name: string
  status?: 'ok' | 'error'
  attributes: Record<string, unknown>
}

/** Create a mock logger that captures all log calls. */
function makeMockLogger() {
  const logs: LogRecord[] = []
  const capture = (level: string) =>
    (msg: string, data?: Record<string, unknown>) => { logs.push({ level, message: msg, data }) }

  return {
    logs,
    logger: {
      debug: capture('debug'),
      info: capture('info'),
      warn: capture('warn'),
      error: capture('error'),
      flush: async () => {},
    },
  }
}

/** Create a mock tracer that captures span start/end calls. */
function makeMockTracer() {
  const spans: SpanRecord[] = []
  let counter = 0

  return {
    spans,
    tracer: {
      startSpan: (name: string, attributes?: Record<string, unknown>) => {
        const span: SpanRecord = { name, attributes: attributes ?? {} }
        spans.push(span)
        return { spanId: `span-${counter++}`, name, attributes: attributes ?? {} }
      },
      endSpan: (
        span: { spanId: string; name: string },
        status: 'ok' | 'error',
        attributes?: Record<string, unknown>,
      ) => {
        const record = spans.find(s => s.name === span.name && !s.status)
        if (record) {
          record.status = status
          Object.assign(record.attributes, attributes ?? {})
        }
      },
      flush: async () => {},
      setSessionId: () => {},
      getTraceId: () => 'test-trace-id',
    } as unknown as AppContext['tracer'],
  }
}

/** Minimal mock provider that streams a single text response. */
const defaultProvider: IProvider = {
  name: 'mock',
  chat: async () => { throw new Error('not implemented') },
  async *stream() {
    yield { type: 'text', delta: 'done' }
    yield { type: 'done' }
  },
}

/** Build an AppContext + config with mock logger/tracer. Returns log/span collectors. */
function makeApp(overrides?: { provider?: IProvider }) {
  const provider = overrides?.provider ?? defaultProvider
  const { logs, logger } = makeMockLogger()
  const { spans, tracer } = makeMockTracer()

  const config: RaConfig = {
    app: {
      interface: 'cron',
      configDir: process.cwd(),
      dataDir: tmpdir('ra-cron-test'),
      http: { port: 3000, token: '' },
      inspector: { port: 3002 },
      storage: { format: 'jsonl', maxSessions: 100, ttlDays: 30 },
      providers: {
        anthropic: { apiKey: 'test' },
        openai: { apiKey: '' },
        'openai-completions': { apiKey: '' },
        google: { apiKey: '' },
        ollama: { host: '' },
        bedrock: { region: '' },
        azure: { endpoint: '', deployment: '', apiKey: '' },
        codex: { accessToken: '' },
        'anthropic-agents-sdk': {},
      },
      mcpServers: [],
      mcpLazySchemas: false,
      raMcpServer: { enabled: false, port: 3001, tool: { name: 'ra', description: 'test' } },
      logsEnabled: false,
      logLevel: 'error',
      tracesEnabled: false,
    },
    agent: {
      provider: 'anthropic',
      model: 'test-model',
      systemPrompt: 'You are helpful.',
      maxIterations: 5,
      maxRetries: 1,
      toolTimeout: 5000,
      maxConcurrency: 1,
      parallelToolCalls: true,
      maxTokenBudget: 0,
      maxDuration: 0,
      hotReload: true,
      tools: { builtin: false, overrides: {} },
      skillDirs: [],
      permissions: {},
      middleware: {},
      context: { enabled: false, patterns: [], resolvers: [], subdirectoryWalk: true },
      compaction: { enabled: false, threshold: 0.8 },
      memory: { enabled: false, maxMemories: 100, ttlDays: 30, injectLimit: 5 },
      web: { panels: [] },
    },
    cron: [],
  }

  const app = {
    config,
    provider,
    tools: new ToolRegistry(),
    middleware: {},
    skillIndex: new Map(),
    storage: undefined!, // set by individual tests
    sessionId: 'test',
    contextMessages: [],
    memoryStore: undefined,
    scratchpadStore: undefined,
    mcpClient: { disconnect: async () => {} } as AppContext['mcpClient'],
    logger,
    tracer,
    shutdown: async () => {},
  } as unknown as AppContext

  return { app, config, logs, spans }
}

/** Find a log entry by message (and optional data key/value). */
function findLog(logs: LogRecord[], message: string, data?: Record<string, unknown>): LogRecord | undefined {
  return logs.find(l => {
    if (l.message !== message) return false
    if (!data) return true
    return Object.entries(data).every(([k, v]) => l.data?.[k] === v)
  })
}

/** Run a cron job once then abort. */
async function runOnce(
  app: AppContext,
  jobs: CronJob[],
  callbacks?: {
    onJobStart?: (job: CronJob) => void
    onJobEnd?: (job: CronJob, result: { ok: boolean; error?: string }) => void
  },
) {
  const controller = new AbortController()
  await runCron({
    app,
    jobs,
    signal: controller.signal,
    runImmediately: true,
    onJobStart: callbacks?.onJobStart,
    onJobEnd: (job, result) => {
      callbacks?.onJobEnd?.(job, result)
      controller.abort()
    },
  })
}


describe('runCron', () => {
  describe('validation', () => {
    it('warns and returns when no jobs are configured', async () => {
      const { app, logs } = makeApp()
      await runCron({ app, jobs: [], runImmediately: true })

      expect(findLog(logs, 'no cron jobs configured')).toBeDefined()
    })

    it('skips jobs with invalid cron expressions', async () => {
      const { app, logs } = makeApp()
      const jobs: CronJob[] = [
        { name: 'bad-job', schedule: 'not-a-cron', prompt: 'hello' },
      ]

      await runCron({ app, jobs, runImmediately: true })

      expect(findLog(logs, 'invalid cron expression', { job: 'bad-job' })).toBeDefined()
      expect(findLog(logs, 'no valid cron jobs to schedule')).toBeDefined()
    })
  })

  describe('execution', () => {
    it('runs a job and delivers the prompt to the provider', async () => {
      const prompts: string[] = []
      const provider: IProvider = {
        name: 'mock',
        chat: async () => { throw new Error('not implemented') },
        async *stream(req) {
          const userMsg = req.messages.filter(m => m.role === 'user').pop()
          if (userMsg && typeof userMsg.content === 'string') prompts.push(userMsg.content)
          yield { type: 'text', delta: 'response' }
          yield { type: 'done' }
        },
      }

      const { app } = makeApp({ provider })
      app.storage = await makeStorage('ra-cron-exec')

      const started: string[] = []
      const completed: string[] = []
      const jobs: CronJob[] = [
        { name: 'test-job', schedule: '* * * * *', prompt: 'do the thing' },
      ]

      await runOnce(app, jobs, {
        onJobStart: (job) => { started.push(job.name) },
        onJobEnd: (job) => { completed.push(job.name) },
      })

      expect(started).toContain('test-job')
      expect(completed).toContain('test-job')
      expect(prompts).toContain('do the thing')
    })

    it('handles job execution failure gracefully', async () => {
      const provider: IProvider = {
        name: 'mock',
        chat: async () => { throw new Error('not implemented') },
        async *stream() { throw new Error('model exploded') },
      }

      const { app } = makeApp({ provider })
      app.storage = await makeStorage('ra-cron-fail')

      const failures: string[] = []
      const jobs: CronJob[] = [
        { name: 'failing-job', schedule: '* * * * *', prompt: 'crash' },
      ]

      await runOnce(app, jobs, {
        onJobEnd: (_job, result) => {
          if (!result.ok) failures.push(result.error ?? 'unknown')
        },
      })

      expect(failures).toHaveLength(1)
      expect(failures[0]).toContain('model exploded')
    })

    it('merges per-job agent config overrides', async () => {
      let capturedModel = ''
      const provider: IProvider = {
        name: 'mock',
        chat: async () => { throw new Error('not implemented') },
        async *stream(req) {
          capturedModel = req.model
          yield { type: 'text', delta: 'ok' }
          yield { type: 'done' }
        },
      }

      const { app } = makeApp({ provider })
      app.storage = await makeStorage('ra-cron-merge')

      const jobs: CronJob[] = [{
        name: 'override-job',
        schedule: '* * * * *',
        prompt: 'check',
        agent: { model: 'claude-haiku-4-5', maxIterations: 3 },
      }]

      await runOnce(app, jobs)

      expect(capturedModel).toBe('claude-haiku-4-5')
    })

    it('creates a session per job execution', async () => {
      const { app } = makeApp()
      const storage = await makeStorage('ra-cron-session')
      app.storage = storage

      const before = (await storage.list()).length

      await runOnce(app, [
        { name: 'session-job', schedule: '* * * * *', prompt: 'test' },
      ])

      const after = await storage.list()
      expect(after.length).toBe(before + 1)
      expect(after.some(s => s.meta.interface === 'cron')).toBe(true)
    })

    it('stops when abort signal fires during sleep', async () => {
      const { app } = makeApp()
      app.storage = await makeStorage('ra-cron-abort')

      const controller = new AbortController()
      // Job scheduled in the future — scheduler will sleep
      const promise = runCron({
        app,
        jobs: [{ name: 'future-job', schedule: '0 0 1 1 *', prompt: 'test' }],
        signal: controller.signal,
      })

      // Abort while sleeping
      setTimeout(() => controller.abort(), 50)
      await promise
      // If we get here, the scheduler stopped correctly
    })
  })

  describe('logging', () => {
    it('emits structured logs for the full scheduler lifecycle', async () => {
      const { app, logs } = makeApp()
      app.storage = await makeStorage('ra-cron-logs')

      const jobs: CronJob[] = [
        { name: 'log-job', schedule: '* * * * *', prompt: 'test' },
      ]

      await runOnce(app, jobs)

      // Scheduler lifecycle
      expect(findLog(logs, 'cron scheduler starting', { jobCount: 1 })).toBeDefined()
      expect(findLog(logs, 'cron job scheduled', { job: 'log-job' })).toBeDefined()
      expect(findLog(logs, 'cron scheduler stopped')).toBeDefined()

      // Job lifecycle
      expect(findLog(logs, 'cron job starting', { job: 'log-job' })).toBeDefined()
      expect(findLog(logs, 'cron job executing', { job: 'log-job' })).toBeDefined()
      expect(findLog(logs, 'cron job session created', { job: 'log-job' })).toBeDefined()
      expect(findLog(logs, 'cron job completed', { job: 'log-job' })).toBeDefined()
      expect(findLog(logs, 'cron job rescheduled', { job: 'log-job' })).toBeDefined()
    })

    it('includes usage data in completion log', async () => {
      const { app, logs } = makeApp()
      app.storage = await makeStorage('ra-cron-usage-log')

      await runOnce(app, [
        { name: 'usage-job', schedule: '* * * * *', prompt: 'test' },
      ])

      const completed = findLog(logs, 'cron job completed', { job: 'usage-job' })
      expect(completed).toBeDefined()
      expect(completed!.data?.sessionId).toBeDefined()
      expect(typeof completed!.data?.iterations).toBe('number')
      expect(typeof completed!.data?.inputTokens).toBe('number')
      expect(typeof completed!.data?.outputTokens).toBe('number')
    })

    it('logs failure details when a job errors', async () => {
      const provider: IProvider = {
        name: 'mock',
        chat: async () => { throw new Error('not implemented') },
        async *stream() { throw new Error('boom') },
      }

      const { app, logs } = makeApp({ provider })
      app.storage = await makeStorage('ra-cron-log-err')

      await runOnce(app, [
        { name: 'error-job', schedule: '* * * * *', prompt: 'crash' },
      ])

      const failLog = findLog(logs, 'cron job failed', { job: 'error-job' })
      expect(failLog).toBeDefined()
      expect(failLog!.data?.error).toContain('boom')
    })
  })

  describe('tracing', () => {
    it('creates spans for the scheduler and each job', async () => {
      const { app, spans } = makeApp()
      app.storage = await makeStorage('ra-cron-traces')

      await runOnce(app, [
        { name: 'traced-job', schedule: '* * * * *', prompt: 'test' },
      ])

      // Scheduler span
      const scheduler = spans.find(s => s.name === 'cron.scheduler')
      expect(scheduler).toBeDefined()
      expect(scheduler!.status).toBe('ok')
      expect(scheduler!.attributes.jobCount).toBe(1)
      expect(scheduler!.attributes.jobsRun).toBe(1)
      expect(scheduler!.attributes.jobsFailed).toBe(0)

      // Job span
      const job = spans.find(s => s.name === 'cron.job')
      expect(job).toBeDefined()
      expect(job!.status).toBe('ok')
      expect(job!.attributes.job).toBe('traced-job')
      expect(job!.attributes.sessionId).toBeDefined()
    })

    it('marks job span as error on failure', async () => {
      const provider: IProvider = {
        name: 'mock',
        chat: async () => { throw new Error('not implemented') },
        async *stream() { throw new Error('boom') },
      }

      const { app, spans } = makeApp({ provider })
      app.storage = await makeStorage('ra-cron-trace-err')

      await runOnce(app, [
        { name: 'error-traced', schedule: '* * * * *', prompt: 'crash' },
      ])

      const job = spans.find(s => s.name === 'cron.job')
      expect(job).toBeDefined()
      expect(job!.status).toBe('error')
      expect(job!.attributes.error).toContain('boom')
    })

    it('marks scheduler span as error when no jobs are valid', async () => {
      const { app, spans } = makeApp()

      await runCron({
        app,
        jobs: [{ name: 'invalid', schedule: 'bad', prompt: 'hello' }],
        runImmediately: true,
      })

      const scheduler = spans.find(s => s.name === 'cron.scheduler')
      expect(scheduler).toBeDefined()
      expect(scheduler!.status).toBe('error')
      expect(scheduler!.attributes.reason).toBe('no_valid_jobs')
    })
  })
})
