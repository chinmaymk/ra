import { describe, it, expect } from 'bun:test'
import { runCron } from '../../src/interfaces/cron'
import { ToolRegistry } from '@chinmaymk/ra'
import type { IProvider } from '@chinmaymk/ra'
import type { AppContext } from '../../src/bootstrap'
import type { RaConfig, CronJob } from '../../src/config/types'
import { makeStorage } from '../fixtures'
import { tmpdir } from '../tmpdir'

interface SpanRecord {
  name: string
  status?: 'ok' | 'error'
  attributes: Record<string, unknown>
}

function makeMockTracer() {
  const spans: SpanRecord[] = []
  let spanCounter = 0
  return {
    spans,
    tracer: {
      startSpan: (name: string, attributes?: Record<string, unknown>) => {
        const span: SpanRecord = { name, attributes: attributes ?? {} }
        spans.push(span)
        return { spanId: `span-${spanCounter++}`, name, attributes: attributes ?? {} }
      },
      endSpan: (span: { spanId: string; name: string }, status: 'ok' | 'error', attributes?: Record<string, unknown>) => {
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

interface LogRecord {
  level: string
  message: string
  data?: Record<string, unknown>
}

function makeMockLogger() {
  const logs: LogRecord[] = []
  const logger = {
    debug: (msg: string, data?: Record<string, unknown>) => { logs.push({ level: 'debug', message: msg, data }) },
    info: (msg: string, data?: Record<string, unknown>) => { logs.push({ level: 'info', message: msg, data }) },
    warn: (msg: string, data?: Record<string, unknown>) => { logs.push({ level: 'warn', message: msg, data }) },
    error: (msg: string, data?: Record<string, unknown>) => { logs.push({ level: 'error', message: msg, data }) },
    flush: async () => {},
  }
  return { logs, logger }
}

function makeApp(overrides: {
  provider?: IProvider
  jobs?: CronJob[]
}): { app: AppContext; config: RaConfig; logs: LogRecord[]; spans: SpanRecord[] } {
  const provider: IProvider = overrides.provider ?? {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'text', delta: 'done' }
      yield { type: 'done' }
    },
  }

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
      skillDirs: [],
      skills: [],
      mcp: {
        client: [],
        server: { enabled: false, port: 3001, tool: { name: 'ra', description: 'test' } },
        lazySchemas: false,
      },
      permissions: {},
      logsEnabled: false,
      logLevel: 'error',
      tracesEnabled: false,
    },
    agent: {
      provider: 'anthropic',
      model: 'test-model',
      systemPrompt: 'You are helpful.',
      providers: {
        anthropic: { apiKey: 'test' },
        openai: { apiKey: '' },
        'openai-completions': { apiKey: '' },
        google: { apiKey: '' },
        ollama: { host: '' },
        bedrock: { region: '' },
        azure: { endpoint: '', deployment: '', apiKey: '' },
      },
      maxIterations: 5,
      maxRetries: 1,
      toolTimeout: 5000,
      maxConcurrency: 1,
      tools: { builtin: false, overrides: {} },
      middleware: {},
      context: { enabled: false, patterns: [], resolvers: [] },
      compaction: { enabled: false, threshold: 0.8 },
      memory: { enabled: false, maxMemories: 100, ttlDays: 30, injectLimit: 5 },
    },
    cron: overrides.jobs ?? [],
  }

  const app = {
    config,
    provider,
    tools: new ToolRegistry(),
    middleware: {},
    skillMap: new Map(),
    storage: undefined!, // will be set in tests that need it
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

describe('runCron', () => {
  it('warns and returns when no jobs are configured', async () => {
    const { app, logs } = makeApp({ jobs: [] })

    await runCron({ app, jobs: [], runImmediately: true })
    expect(logs.some(l => l.message === 'no cron jobs configured' && l.level === 'warn')).toBe(true)
  })

  it('skips jobs with invalid cron expressions', async () => {
    const { app, logs } = makeApp({ jobs: [] })

    const jobs: CronJob[] = [
      { name: 'bad-job', schedule: 'not-a-cron', prompt: 'hello' },
    ]

    await runCron({ app, jobs, runImmediately: true })
    expect(logs.some(l => l.message === 'invalid cron expression' && l.data?.job === 'bad-job')).toBe(true)
    expect(logs.some(l => l.message === 'no valid cron jobs to schedule')).toBe(true)
  })

  it('executes a job and stops on abort', async () => {
    const storage = await makeStorage('ra-cron-exec')
    const prompts: string[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        const userMsg = req.messages.filter(m => m.role === 'user').pop()
        if (userMsg && typeof userMsg.content === 'string') {
          prompts.push(userMsg.content)
        }
        yield { type: 'text', delta: 'response' }
        yield { type: 'done' }
      },
    }

    const { app } = makeApp({ provider })
    app.storage = storage

    const controller = new AbortController()
    const startedJobs: string[] = []
    const completedJobs: string[] = []

    const jobs: CronJob[] = [
      { name: 'test-job', schedule: '* * * * *', prompt: 'do the thing' },
    ]

    await runCron({
      app,
      jobs,
      signal: controller.signal,
      runImmediately: true,
      onJobStart: (job) => { startedJobs.push(job.name) },
      onJobEnd: (job) => {
        completedJobs.push(job.name)
        controller.abort()
      },
    })

    expect(startedJobs).toContain('test-job')
    expect(completedJobs).toContain('test-job')
    expect(prompts).toContain('do the thing')
  })

  it('handles job execution failure gracefully', async () => {
    const storage = await makeStorage('ra-cron-fail')
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        throw new Error('model exploded')
      },
    }

    const { app } = makeApp({ provider })
    app.storage = storage

    const controller = new AbortController()
    const failures: string[] = []

    const jobs: CronJob[] = [
      { name: 'failing-job', schedule: '* * * * *', prompt: 'crash' },
    ]

    await runCron({
      app,
      jobs,
      signal: controller.signal,
      runImmediately: true,
      onJobEnd: (_job, result) => {
        if (!result.ok) failures.push(result.error ?? 'unknown')
        controller.abort()
      },
    })

    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('model exploded')
  })

  it('merges partial agent config override', async () => {
    const storage = await makeStorage('ra-cron-merge')
    let capturedModel = ''
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        capturedModel = req.model
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }

    const { app } = makeApp({ provider })
    app.storage = storage

    const controller = new AbortController()
    const jobs: CronJob[] = [
      {
        name: 'override-job',
        schedule: '* * * * *',
        prompt: 'check',
        agent: { model: 'claude-haiku-4-5', maxIterations: 3 },
      },
    ]

    await runCron({
      app,
      jobs,
      signal: controller.signal,
      runImmediately: true,
      onJobEnd: () => { controller.abort() },
    })

    expect(capturedModel).toBe('claude-haiku-4-5')
  })

  it('logs scheduler lifecycle events', async () => {
    const storage = await makeStorage('ra-cron-logs')
    const { app, logs } = makeApp({})
    app.storage = storage

    const controller = new AbortController()
    const jobs: CronJob[] = [
      { name: 'log-job', schedule: '* * * * *', prompt: 'test' },
    ]

    await runCron({
      app,
      jobs,
      signal: controller.signal,
      runImmediately: true,
      onJobEnd: () => { controller.abort() },
    })

    // Scheduler lifecycle logs
    expect(logs.some(l => l.message === 'cron scheduler starting' && l.data?.jobCount === 1)).toBe(true)
    expect(logs.some(l => l.message === 'cron job scheduled' && l.data?.name === 'log-job')).toBe(true)
    expect(logs.some(l => l.message === 'cron job starting' && l.data?.name === 'log-job')).toBe(true)
    expect(logs.some(l => l.message === 'cron job executing' && l.data?.job === 'log-job')).toBe(true)
    expect(logs.some(l => l.message === 'cron job session created' && l.data?.job === 'log-job')).toBe(true)
    expect(logs.some(l => l.message === 'cron job completed' && l.data?.job === 'log-job')).toBe(true)
    expect(logs.some(l => l.message === 'cron job rescheduled' && l.data?.name === 'log-job')).toBe(true)
    expect(logs.some(l => l.message === 'cron scheduler stopped')).toBe(true)
  })

  it('creates tracer spans for scheduler and jobs', async () => {
    const storage = await makeStorage('ra-cron-traces')
    const { app, spans } = makeApp({})
    app.storage = storage

    const controller = new AbortController()
    const jobs: CronJob[] = [
      { name: 'traced-job', schedule: '* * * * *', prompt: 'test' },
    ]

    await runCron({
      app,
      jobs,
      signal: controller.signal,
      runImmediately: true,
      onJobEnd: () => { controller.abort() },
    })

    // Scheduler span
    const schedulerSpan = spans.find(s => s.name === 'cron.scheduler')
    expect(schedulerSpan).toBeDefined()
    expect(schedulerSpan!.status).toBe('ok')
    expect(schedulerSpan!.attributes.jobCount).toBe(1)
    expect(schedulerSpan!.attributes.jobsRun).toBe(1)
    expect(schedulerSpan!.attributes.jobsFailed).toBe(0)

    // Job span
    const jobSpan = spans.find(s => s.name === 'cron.job')
    expect(jobSpan).toBeDefined()
    expect(jobSpan!.status).toBe('ok')
    expect(jobSpan!.attributes.job).toBe('traced-job')
    expect(jobSpan!.attributes.sessionId).toBeDefined()
  })

  it('creates error tracer span on job failure', async () => {
    const storage = await makeStorage('ra-cron-trace-err')
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        throw new Error('boom')
      },
    }

    const { app, spans, logs } = makeApp({ provider })
    app.storage = storage

    const controller = new AbortController()
    const jobs: CronJob[] = [
      { name: 'error-traced', schedule: '* * * * *', prompt: 'crash' },
    ]

    await runCron({
      app,
      jobs,
      signal: controller.signal,
      runImmediately: true,
      onJobEnd: () => { controller.abort() },
    })

    // Job span should be marked as error
    const jobSpan = spans.find(s => s.name === 'cron.job')
    expect(jobSpan).toBeDefined()
    expect(jobSpan!.status).toBe('error')
    expect(jobSpan!.attributes.error).toContain('boom')

    // App-level logger should record the failure (logged from executeJob with `job` key)
    expect(logs.some(l => l.message === 'cron job failed' && l.data?.job === 'error-traced')).toBe(true)
  })

  it('logs include job metadata for invalid schedule errors', async () => {
    const { app, spans } = makeApp({ jobs: [] })

    const jobs: CronJob[] = [
      { name: 'invalid-schedule', schedule: 'bad', prompt: 'hello' },
    ]

    await runCron({ app, jobs, runImmediately: true })

    // Scheduler span should be marked error when no valid jobs
    const schedulerSpan = spans.find(s => s.name === 'cron.scheduler')
    expect(schedulerSpan).toBeDefined()
    expect(schedulerSpan!.status).toBe('error')
    expect(schedulerSpan!.attributes.reason).toBe('no_valid_jobs')
  })
})
