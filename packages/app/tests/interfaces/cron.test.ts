import { describe, it, expect, afterEach } from 'bun:test'
import { runCron } from '../../src/interfaces/cron'
import { ToolRegistry } from '@chinmaymk/ra'
import type { IProvider } from '@chinmaymk/ra'
import type { AppContext } from '../../src/bootstrap'
import type { RaConfig, CronJob } from '../../src/config/types'
import { makeStorage, captureStderr } from '../fixtures'
import { tmpdir } from '../tmpdir'

function makeApp(overrides: {
  provider?: IProvider
  jobs?: CronJob[]
}): { app: AppContext; config: RaConfig } {
  const provider: IProvider = overrides.provider ?? {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'text', delta: 'done' }
      yield { type: 'done' }
    },
  }

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
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
      flush: async () => {},
      level: 'error' as const,
    },
    tracer: {
      startSpan: () => 'span',
      endSpan: () => {},
      flush: async () => {},
    } as unknown as AppContext['tracer'],
    shutdown: async () => {},
  } as unknown as AppContext

  return { app, config }
}

describe('runCron', () => {
  it('warns and returns when no jobs are configured', async () => {
    const { app } = makeApp({ jobs: [] })
    const warnings: string[] = []
    app.logger.warn = (msg: string) => { warnings.push(msg) }

    await runCron({ app, jobs: [], runImmediately: true })
    expect(warnings).toContain('no cron jobs configured')
  })

  it('skips jobs with invalid cron expressions', async () => {
    const { app } = makeApp({ jobs: [] })
    const errors: string[] = []
    app.logger.error = (msg: string) => { errors.push(msg) }

    const jobs: CronJob[] = [
      { name: 'bad-job', schedule: 'not-a-cron', prompt: 'hello' },
    ]

    await runCron({ app, jobs, runImmediately: true })
    expect(errors.some(e => e.includes('invalid cron expression') || e.includes('no valid cron jobs'))).toBe(true)
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

    // Use a schedule that fires every second (for test speed)
    // "* * * * * *" with seconds is not standard, use every minute
    // Instead, we'll use a schedule that's already past so it runs immediately
    const jobs: CronJob[] = [
      { name: 'test-job', schedule: '* * * * *', prompt: 'do the thing' },
    ]

    // Abort after first job completes
    const cronPromise = runCron({
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

    await cronPromise

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
})
