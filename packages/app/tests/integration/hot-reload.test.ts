import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { bootstrap, type AppContext } from '../../src/bootstrap'
import { loadConfigWithPath } from '../../src/config'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { spawnHttpServer, type InteractiveProcess } from './helpers/binary'

/**
 * Helper: bootstrap a minimal AppContext from a config directory.
 * Disables context discovery and skills for fast, isolated tests.
 */
async function bootstrapFromDir(dir: string): Promise<AppContext> {
  const loadOptions = { cwd: dir, env: {} }
  const { config, filePath, systemPromptPath } = await loadConfigWithPath(loadOptions)
  return bootstrap(config, {
    skipSession: true,
    configFilePath: filePath,
    systemPromptPath,
    loadOptions,
  })
}

describe('Config hot-reload integration', () => {
  let tmp: string

  beforeAll(() => {
    tmp = join(tmpdir(), `ra-hotreload-int-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  // ── Config file changes ───────────────────────────────────────────

  it('refreshIfNeeded returns false when nothing changed', async () => {
    const dir = join(tmp, 'no-change')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({
      agent: { model: 'original', context: { enabled: false }, skillDirs: [] },
    }))

    const app = await bootstrapFromDir(dir)
    expect(await app.refreshIfNeeded()).toBe(false)
    expect(app.config.agent.model).toBe('original')
    await app.shutdown()
  })

  it('refreshIfNeeded picks up new model from config file', async () => {
    const dir = join(tmp, 'model-change')
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({
      agent: { model: 'model-v1', context: { enabled: false }, skillDirs: [] },
    }))

    const app = await bootstrapFromDir(dir)
    expect(app.config.agent.model).toBe('model-v1')

    // Modify config file
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(configPath, JSON.stringify({
      agent: { model: 'model-v2', context: { enabled: false }, skillDirs: [] },
    }))

    expect(await app.refreshIfNeeded()).toBe(true)
    expect(app.config.agent.model).toBe('model-v2')
    await app.shutdown()
  })

  it('refreshIfNeeded picks up new maxIterations', async () => {
    const dir = join(tmp, 'iterations-change')
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({
      agent: { maxIterations: 10, context: { enabled: false }, skillDirs: [] },
    }))

    const app = await bootstrapFromDir(dir)
    expect(app.config.agent.maxIterations).toBe(10)

    await new Promise(r => setTimeout(r, 50))
    writeFileSync(configPath, JSON.stringify({
      agent: { maxIterations: 50, context: { enabled: false }, skillDirs: [] },
    }))

    expect(await app.refreshIfNeeded()).toBe(true)
    expect(app.config.agent.maxIterations).toBe(50)
    await app.shutdown()
  })

  // ── System prompt file changes ────────────────────────────────────

  it('refreshIfNeeded picks up system prompt file changes', async () => {
    const dir = join(tmp, 'prompt-change')
    mkdirSync(dir, { recursive: true })
    const promptPath = join(dir, 'prompt.txt')
    writeFileSync(promptPath, 'You are a pirate.')
    writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({
      agent: { systemPrompt: './prompt.txt', context: { enabled: false }, skillDirs: [] },
    }))

    const app = await bootstrapFromDir(dir)
    expect(app.config.agent.systemPrompt).toBe('You are a pirate.')

    // Modify prompt file (config file itself unchanged)
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(promptPath, 'You are a ninja.')

    expect(await app.refreshIfNeeded()).toBe(true)
    expect(app.config.agent.systemPrompt).toBe('You are a ninja.')
    await app.shutdown()
  })

  // ── Custom tool file changes ──────────────────────────────────────

  it('refreshIfNeeded rebuilds tools when custom tool file changes', async () => {
    const dir = join(tmp, 'tool-change')
    mkdirSync(dir, { recursive: true })
    const toolPath = join(dir, 'my-tool.ts')
    writeFileSync(toolPath, `
export default {
  name: 'MyTool',
  description: 'Version 1',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'v1' },
}
`)
    writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({
      agent: {
        tools: { builtin: false, custom: [toolPath] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    const app = await bootstrapFromDir(dir)
    const toolV1 = app.tools.get('MyTool')
    expect(toolV1).toBeDefined()
    expect(toolV1!.description).toBe('Version 1')

    // Modify tool file (config file unchanged)
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(toolPath, `
export default {
  name: 'MyTool',
  description: 'Version 2',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'v2' },
}
`)

    expect(await app.refreshIfNeeded()).toBe(true)
    const toolV2 = app.tools.get('MyTool')
    expect(toolV2).toBeDefined()
    expect(toolV2!.description).toBe('Version 2')
    await app.shutdown()
  })

  it('refreshIfNeeded picks up a new custom tool added to config', async () => {
    const dir = join(tmp, 'tool-add')
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, 'ra.config.json')
    const toolPath = join(dir, 'added-tool.ts')
    writeFileSync(toolPath, `
export default {
  name: 'AddedTool',
  description: 'Newly added',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'hello' },
}
`)
    writeFileSync(configPath, JSON.stringify({
      agent: {
        tools: { builtin: false, custom: [] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    const app = await bootstrapFromDir(dir)
    expect(app.tools.get('AddedTool')).toBeUndefined()

    // Update config to reference the new tool
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(configPath, JSON.stringify({
      agent: {
        tools: { builtin: false, custom: [toolPath] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    expect(await app.refreshIfNeeded()).toBe(true)
    expect(app.tools.get('AddedTool')).toBeDefined()
    await app.shutdown()
  })

  // ── Middleware file changes ───────────────────────────────────────

  it('refreshIfNeeded reloads middleware when middleware file changes', async () => {
    const dir = join(tmp, 'mw-change')
    mkdirSync(dir, { recursive: true })
    const mwPath = join(dir, 'mw.ts')
    writeFileSync(mwPath, `export default async () => {}`)
    writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({
      agent: {
        middleware: { beforeModelCall: [mwPath] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    const app = await bootstrapFromDir(dir)
    const mwBefore = app.middleware.beforeModelCall

    // Modify middleware file (config file unchanged)
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(mwPath, `export default async (ctx) => { ctx.modified = true }`)

    expect(await app.refreshIfNeeded()).toBe(true)
    // Middleware array is a new reference (rebuilt)
    expect(app.middleware.beforeModelCall).not.toBe(mwBefore)
    // User middleware hook is still registered
    expect(app.middleware.beforeModelCall?.length).toBeGreaterThanOrEqual(1)
    await app.shutdown()
  })

  // ── Provider rebuild ──────────────────────────────────────────────

  it('refreshIfNeeded rebuilds provider when provider config changes', async () => {
    const dir = join(tmp, 'provider-change')
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({
      agent: { provider: 'anthropic', context: { enabled: false }, skillDirs: [] },
    }))

    const app = await bootstrapFromDir(dir)
    const originalProvider = app.provider

    // Switch provider
    await new Promise(r => setTimeout(r, 50))
    writeFileSync(configPath, JSON.stringify({
      agent: { provider: 'openai', context: { enabled: false }, skillDirs: [] },
    }))

    expect(await app.refreshIfNeeded()).toBe(true)
    expect(app.config.agent.provider).toBe('openai')
    expect(app.provider).not.toBe(originalProvider)
    expect(app.provider.name).toBe('openai')
    await app.shutdown()
  })

  // ── No spurious reload ────────────────────────────────────────────

  it('second refreshIfNeeded returns false when no further changes', async () => {
    const dir = join(tmp, 'no-spurious')
    mkdirSync(dir, { recursive: true })
    const configPath = join(dir, 'ra.config.json')
    writeFileSync(configPath, JSON.stringify({
      agent: { model: 'v1', context: { enabled: false }, skillDirs: [] },
    }))

    const app = await bootstrapFromDir(dir)

    await new Promise(r => setTimeout(r, 50))
    writeFileSync(configPath, JSON.stringify({
      agent: { model: 'v2', context: { enabled: false }, skillDirs: [] },
    }))

    expect(await app.refreshIfNeeded()).toBe(true)
    expect(app.config.agent.model).toBe('v2')

    // No further changes — should not reload
    expect(await app.refreshIfNeeded()).toBe(false)
    await app.shutdown()
  })
})

// ── HTTP end-to-end hot-reload ────────────────────────────────────────

describe('HTTP hot-reload end-to-end', () => {
  let env: TestEnv
  let tmp: string
  let httpProc: InteractiveProcess
  let BASE_URL: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmp = join(tmpdir(), `ra-hotreload-http-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })

    // Write initial config with a custom tool
    const toolPath = join(tmp, 'greet.ts')
    writeFileSync(toolPath, `
export default {
  name: 'Greet',
  description: 'Greet someone',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  async execute(input: unknown) {
    const { name } = input as { name: string }
    return 'Hello, ' + name + '!'
  },
}
`)
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: {
        tools: { custom: [toolPath] },
        context: { enabled: false },
        skillDirs: [],
      },
    }))

    const { proc, port } = await spawnHttpServer(
      ['--http', '--config', join(tmp, 'ra.config.json')],
      env.binaryEnv,
    )
    httpProc = proc
    BASE_URL = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    httpProc.kill()
    rmSync(tmp, { recursive: true, force: true })
    await env.cleanup()
  })

  afterEach(() => env.mock.resetRequests())

  it('picks up custom tool file change between HTTP requests', async () => {
    // First request — tool returns "Hello, Alice!"
    env.mock.enqueue([{ type: 'tool_call', name: 'Greet', args: { name: 'Alice' } }])
    env.mock.enqueue([{ type: 'text', content: 'Greeted Alice.' }])

    const res1 = await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'greet Alice' }] }),
    })
    expect(res1.status).toBe(200)
    const data1 = await res1.json() as { response: string }
    expect(data1.response).toContain('Greeted Alice.')

    // Verify tool returned "Hello, Alice!"
    const reqs1 = env.mock.requests()
    const secondReq = JSON.stringify(reqs1[1]?.body)
    expect(secondReq).toContain('Hello, Alice!')

    env.mock.resetRequests()

    // Modify the tool file to change greeting format
    await new Promise(r => setTimeout(r, 50))
    const toolPath = join(tmp, 'greet.ts')
    writeFileSync(toolPath, `
export default {
  name: 'Greet',
  description: 'Greet someone formally',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  async execute(input: unknown) {
    const { name } = input as { name: string }
    return 'Good day, ' + name + '. How do you do?'
  },
}
`)

    // Second request — tool should use updated code
    env.mock.enqueue([{ type: 'tool_call', name: 'Greet', args: { name: 'Bob' } }])
    env.mock.enqueue([{ type: 'text', content: 'Greeted Bob formally.' }])

    const res2 = await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'greet Bob' }] }),
    })
    expect(res2.status).toBe(200)

    // Verify tool returned the NEW greeting format
    const reqs2 = env.mock.requests()
    const secondReq2 = JSON.stringify(reqs2[1]?.body)
    expect(secondReq2).toContain('Good day, Bob')
  })
})
