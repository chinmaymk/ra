import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../../src/config'
import { defaultConfig } from '../../src/config/defaults'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('loadConfig', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-config-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns defaults when no config file exists', async () => {
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe(defaultConfig.provider)
    expect(config.model).toBe(defaultConfig.model)
    expect(config.interface).toBe('repl')
    expect(config.maxIterations).toBe(50)
  })

  it('merges CLI args over defaults', async () => {
    const config = await loadConfig({
      cwd: tmp,
      cliArgs: { provider: 'openai', model: 'gpt-4o', maxIterations: 10 },
    })
    expect(config.provider).toBe('openai')
    expect(config.model).toBe('gpt-4o')
    expect(config.maxIterations).toBe(10)
    expect(config.interface).toBe('repl')
  })

  it('resolves systemPrompt from file path', async () => {
    const promptFile = join(tmp, 'prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const config = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: promptFile } })
    expect(config.systemPrompt).toBe('You are a pirate.')
  })

  it('loads JSON config file', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google', maxIterations: 25 }))
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe('google')
    expect(config.maxIterations).toBe(25)
  })

  it('loads YAML config file', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), 'provider: ollama\nmodel: llama3\n')
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe('ollama')
    expect(config.model).toBe('llama3')
  })

  it('loads TOML config file', async () => {
    writeFileSync(join(tmp, 'ra.config.toml'), 'provider = "openai"\nmaxIterations = 5\n')
    const config = await loadConfig({ cwd: tmp })
    expect(config.provider).toBe('openai')
    expect(config.maxIterations).toBe(5)
  })

  describe('env var precedence', () => {
    it('env vars override config file', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google' }))
      const config = await loadConfig({
        cwd: tmp,
        env: { RA_PROVIDER: 'openai', RA_MODEL: 'gpt-4o' },
      })
      expect(config.provider).toBe('openai')
      expect(config.model).toBe('gpt-4o')
    })

    it('CLI args override env vars', async () => {
      const config = await loadConfig({
        cwd: tmp,
        env: { RA_PROVIDER: 'google' },
        cliArgs: { provider: 'ollama' },
      })
      expect(config.provider).toBe('ollama')
    })
  })

  describe('top-level env vars', () => {
    it('RA_PROVIDER', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_PROVIDER: 'openai' } })
      expect(c.provider).toBe('openai')
    })
    it('RA_MODEL', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MODEL: 'gpt-4o' } })
      expect(c.model).toBe('gpt-4o')
    })
    it('RA_INTERFACE', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_INTERFACE: 'http' } })
      expect(c.interface).toBe('http')
    })
    it('RA_SYSTEM_PROMPT', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_SYSTEM_PROMPT: 'Be terse' } })
      expect(c.systemPrompt).toBe('Be terse')
    })
    it('RA_MAX_ITERATIONS', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MAX_ITERATIONS: '99' } })
      expect(c.maxIterations).toBe(99)
    })
  })

  describe('HTTP env vars', () => {
    it('RA_HTTP_PORT', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_HTTP_PORT: '4000' } })
      expect(c.http.port).toBe(4000)
    })
    it('RA_HTTP_TOKEN', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_HTTP_TOKEN: 'secret' } })
      expect(c.http.token).toBe('secret')
    })
    it('RA_HTTP_PORT does not override token from config file', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ http: { port: 3000, token: 'fromfile' } }))
      const c = await loadConfig({ cwd: tmp, env: { RA_HTTP_PORT: '4000' } })
      expect(c.http.port).toBe(4000)
      expect(c.http.token).toBe('fromfile')
    })
  })

  describe('MCP server env vars', () => {
    it('RA_MCP_SERVER_ENABLED=true', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MCP_SERVER_ENABLED: 'true' } })
      expect(c.mcp.server.enabled).toBe(true)
    })
    it('RA_MCP_SERVER_ENABLED=false', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MCP_SERVER_ENABLED: 'false' } })
      expect(c.mcp.server.enabled).toBe(false)
    })
    it('RA_MCP_SERVER_PORT', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MCP_SERVER_PORT: '5001' } })
      expect(c.mcp.server.port).toBe(5001)
    })
    it('RA_MCP_SERVER_TRANSPORT', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MCP_SERVER_TRANSPORT: 'stdio' } })
      expect(c.mcp.server.transport).toBe('stdio')
    })
    it('RA_MCP_SERVER_TOOL_NAME', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MCP_SERVER_TOOL_NAME: 'mybot' } })
      expect(c.mcp.server.tool.name).toBe('mybot')
    })
    it('RA_MCP_SERVER_TOOL_DESCRIPTION', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_MCP_SERVER_TOOL_DESCRIPTION: 'A bot' } })
      expect(c.mcp.server.tool.description).toBe('A bot')
    })
    it('single MCP env var does not clobber siblings', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
        mcp: { server: { enabled: true, port: 3001, transport: 'http', tool: { name: 'ra', description: 'original', inputSchema: {} } } }
      }))
      const c = await loadConfig({ cwd: tmp, env: { RA_MCP_SERVER_PORT: '9000' } })
      expect(c.mcp.server.port).toBe(9000)
      expect(c.mcp.server.enabled).toBe(true)
      expect(c.mcp.server.tool.name).toBe('ra')
    })
  })

  describe('storage env vars', () => {
    it('RA_STORAGE_PATH', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_STORAGE_PATH: '/custom/storage' } })
      expect(c.storage.path).toBe('/custom/storage')
    })
    it('RA_STORAGE_MAX_SESSIONS', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_STORAGE_MAX_SESSIONS: '50' } })
      expect(c.storage.maxSessions).toBe(50)
    })
    it('RA_STORAGE_TTL_DAYS', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_STORAGE_TTL_DAYS: '7' } })
      expect(c.storage.ttlDays).toBe(7)
    })
    it('single storage env var does not clobber siblings', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
        storage: { path: '/from/file', format: 'jsonl', maxSessions: 200, ttlDays: 60 }
      }))
      const c = await loadConfig({ cwd: tmp, env: { RA_STORAGE_PATH: '/from/env' } })
      expect(c.storage.path).toBe('/from/env')
      expect(c.storage.maxSessions).toBe(200)
      expect(c.storage.ttlDays).toBe(60)
    })
  })

  describe('provider credential env vars', () => {
    it('RA_ANTHROPIC_API_KEY', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_ANTHROPIC_API_KEY: 'sk-ant-123' } })
      expect(c.providers.anthropic.apiKey).toBe('sk-ant-123')
    })
    it('RA_ANTHROPIC_BASE_URL', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_ANTHROPIC_BASE_URL: 'https://proxy/' } })
      expect(c.providers.anthropic.baseURL).toBe('https://proxy/')
    })
    it('RA_OPENAI_API_KEY', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_OPENAI_API_KEY: 'sk-oai-123' } })
      expect(c.providers.openai.apiKey).toBe('sk-oai-123')
    })
    it('RA_OPENAI_BASE_URL', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_OPENAI_BASE_URL: 'https://openai-proxy/' } })
      expect(c.providers.openai.baseURL).toBe('https://openai-proxy/')
    })
    it('RA_GOOGLE_API_KEY', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_GOOGLE_API_KEY: 'goog-123' } })
      expect(c.providers.google.apiKey).toBe('goog-123')
    })
    it('RA_OLLAMA_HOST', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_OLLAMA_HOST: 'http://myhost:11434' } })
      expect(c.providers.ollama.host).toBe('http://myhost:11434')
    })
    it('provider env var does not clobber sibling provider', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
        providers: { anthropic: { apiKey: 'from-file' }, openai: { apiKey: 'oai-from-file' }, google: { apiKey: '' }, ollama: {} }
      }))
      const c = await loadConfig({ cwd: tmp, env: { RA_ANTHROPIC_BASE_URL: 'https://proxy/' } })
      expect(c.providers.anthropic.apiKey).toBe('from-file')
      expect(c.providers.anthropic.baseURL).toBe('https://proxy/')
      expect(c.providers.openai.apiKey).toBe('oai-from-file')
    })
  })
})
