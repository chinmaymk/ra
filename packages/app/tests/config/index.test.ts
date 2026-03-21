import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig } from '../../src/config'
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

  it('returns sensible defaults with no config', async () => {
    const c = await loadConfig({ cwd: tmp })
    expect(c.agent.provider).toBe('anthropic')
    expect(c.app.interface).toBe('repl')
    expect(c.agent.maxIterations).toBe(50)
    expect(c.app.skillDirs).toEqual(['.claude/skills', '.agents/skills', '.opencode/skills'])
  })

  it('includes azure provider defaults', async () => {
    const c = await loadConfig({ cwd: tmp })
    expect(c.app.providers.azure).toBeDefined()
    expect(c.app.providers.azure.endpoint).toBe('')
    expect(c.app.providers.azure.deployment).toBe('')
  })

  it('resolves systemPrompt from file when path exists', async () => {
    const promptFile = join(tmp, 'prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('You are a pirate.')
  })

  it('sets configDir to cwd when no config file is found', async () => {
    const c = await loadConfig({ cwd: tmp })
    expect(c.app.configDir).toBe(tmp)
  })

  it('sets configDir to directory containing the config file', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
    const child = join(tmp, 'a', 'b', 'c')
    mkdirSync(child, { recursive: true })
    const c = await loadConfig({ cwd: child })
    expect(c.app.configDir).toBe(tmp)
  })

  describe('config file formats', () => {
    it('loads JSON', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google', maxIterations: 25 } }))
      const c = await loadConfig({ cwd: tmp })
      expect(c.agent.provider).toBe('google')
      expect(c.agent.maxIterations).toBe(25)
    })

    it('loads YAML', async () => {
      writeFileSync(join(tmp, 'ra.config.yaml'), 'agent:\n  provider: ollama\n  model: llama3\n')
      const c = await loadConfig({ cwd: tmp })
      expect(c.agent.provider).toBe('ollama')
      expect(c.agent.model).toBe('llama3')
    })

    it('loads TOML', async () => {
      writeFileSync(join(tmp, 'ra.config.toml'), '[agent]\nprovider = "openai"\nmaxIterations = 5\n')
      const c = await loadConfig({ cwd: tmp })
      expect(c.agent.provider).toBe('openai')
      expect(c.agent.maxIterations).toBe(5)
    })
  })

  describe('upward directory walking', () => {
    it('finds config in a parent directory', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const child = join(tmp, 'a', 'b', 'c')
      mkdirSync(child, { recursive: true })
      const c = await loadConfig({ cwd: child })
      expect(c.agent.provider).toBe('google')
    })

    it('stops at the first config found while walking up', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const mid = join(tmp, 'a')
      mkdirSync(mid, { recursive: true })
      writeFileSync(join(mid, 'ra.config.json'), JSON.stringify({ agent: { provider: 'ollama' } }))
      const child = join(mid, 'b')
      mkdirSync(child, { recursive: true })
      const c = await loadConfig({ cwd: child })
      expect(c.agent.provider).toBe('ollama')
    })

    it('prefers config in cwd over parent', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const child = join(tmp, 'sub')
      mkdirSync(child, { recursive: true })
      writeFileSync(join(child, 'ra.config.json'), JSON.stringify({ agent: { provider: 'openai' } }))
      const c = await loadConfig({ cwd: child })
      expect(c.agent.provider).toBe('openai')
    })
  })

  describe('precedence: defaults < file < env < CLI', () => {
    it('env overrides file', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const c = await loadConfig({ cwd: tmp, env: { RA_PROVIDER: 'openai' } })
      expect(c.agent.provider).toBe('openai')
    })

    it('CLI overrides env', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_PROVIDER: 'google' }, cliArgs: { agent: { provider: 'ollama' } } as any })
      expect(c.agent.provider).toBe('ollama')
    })

    it('deep merge preserves sibling keys when one field is overridden', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
        app: { http: { port: 3000, token: 'fromfile' } }
      }))
      const c = await loadConfig({ cwd: tmp, env: { RA_HTTP_PORT: '4000' } })
      expect(c.app.http.port).toBe(4000)
      expect(c.app.http.token).toBe('fromfile')
    })
  })

  it('ignores non-numeric env var values for integer fields', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_MAX_ITERATIONS: 'abc', RA_HTTP_PORT: 'not-a-number' } })
    // Should fall back to defaults, not NaN
    expect(c.agent.maxIterations).toBe(50)
    expect(c.app.http.port).toBe(3000)
  })

  it('deepMerge: array value in cliArgs replaces array, not merges', async () => {
    // Arrays should be replaced wholesale, not merged
    const c = await loadConfig({
      cwd: tmp,
      cliArgs: { app: { skillDirs: ['/new/dir'] } } as any,
    })
    expect(c.app.skillDirs).toEqual(['/new/dir'])
  })

  it('deepMerge: nested objects are merged, not replaced', async () => {
    // http.port from CLI should not clobber http.token set by env
    const c = await loadConfig({
      cwd: tmp,
      env: { RA_HTTP_TOKEN: 'secret' },
      cliArgs: { app: { http: { port: 9999 } } } as any,
    })
    expect(c.app.http.port).toBe(9999)
    expect(c.app.http.token).toBe('secret')
  })

  it('deepMerge: null in cliArgs is handled (documents overwrite behavior)', async () => {
    const c = await loadConfig({ cwd: tmp, cliArgs: { app: { http: null } } as any })
    expect((c.app as any).http).toBeNull()
  })

  describe('azure env vars', () => {
    it('RA_AZURE_API_KEY sets providers.azure.apiKey', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_API_KEY: 'my-key' } })
      expect(c.app.providers.azure.apiKey).toBe('my-key')
    })

    it('RA_AZURE_ENDPOINT sets providers.azure.endpoint', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_ENDPOINT: 'https://myresource.openai.azure.com/' } })
      expect(c.app.providers.azure.endpoint).toBe('https://myresource.openai.azure.com/')
    })

    it('RA_AZURE_DEPLOYMENT sets providers.azure.deployment', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_DEPLOYMENT: 'my-gpt4o' } })
      expect(c.app.providers.azure.deployment).toBe('my-gpt4o')
    })

    it('RA_AZURE_API_VERSION sets providers.azure.apiVersion', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_API_VERSION: '2024-12-01-preview' } })
      expect(c.app.providers.azure.apiVersion).toBe('2024-12-01-preview')
    })
  })

  it('maps all env vars', async () => {
    const c = await loadConfig({ cwd: tmp, env: {
      RA_PROVIDER: 'openai', RA_MODEL: 'gpt-4o', RA_INTERFACE: 'http',
      RA_SYSTEM_PROMPT: 'Be terse', RA_MAX_ITERATIONS: '99',
      RA_HTTP_PORT: '4000', RA_HTTP_TOKEN: 'secret',
      RA_MCP_SERVER_ENABLED: 'true', RA_MCP_SERVER_PORT: '5001',
      RA_MCP_SERVER_TOOL_NAME: 'mybot',
      RA_MCP_SERVER_TOOL_DESCRIPTION: 'A bot',
      RA_STORAGE_MAX_SESSIONS: '50', RA_STORAGE_TTL_DAYS: '7',
      RA_SKILL_DIRS: '/skills/a,/skills/b',
      RA_ANTHROPIC_API_KEY: 'sk-ant-123', RA_ANTHROPIC_BASE_URL: 'https://ant-proxy/',
      RA_OPENAI_API_KEY: 'sk-oai-123', RA_OPENAI_BASE_URL: 'https://oai-proxy/',
      RA_GOOGLE_API_KEY: 'goog-123', RA_OLLAMA_HOST: 'http://myhost:11434',
    }})
    expect(c.agent.provider).toBe('openai')
    expect(c.agent.model).toBe('gpt-4o')
    expect(c.app.interface).toBe('http')
    expect(c.agent.systemPrompt).toBe('Be terse')
    expect(c.agent.maxIterations).toBe(99)
    expect(c.app.http.port).toBe(4000)
    expect(c.app.http.token).toBe('secret')
    expect(c.app.mcp.server.enabled).toBe(true)
    expect(c.app.mcp.server.port).toBe(5001)
    expect(c.app.mcp.server.tool.name).toBe('mybot')
    expect(c.app.mcp.server.tool.description).toBe('A bot')
    expect(c.app.storage.maxSessions).toBe(50)
    expect(c.app.storage.ttlDays).toBe(7)
    expect(c.app.skillDirs).toEqual(['/skills/a', '/skills/b'])
    expect(c.app.providers.anthropic.apiKey).toBe('sk-ant-123')
    expect(c.app.providers.anthropic.baseURL).toBe('https://ant-proxy/')
    expect(c.app.providers.openai.apiKey).toBe('sk-oai-123')
    expect(c.app.providers.openai.baseURL).toBe('https://oai-proxy/')
    expect(c.app.providers.google.apiKey).toBe('goog-123')
    expect(c.app.providers.ollama.host).toBe('http://myhost:11434')
  })
})

describe('dataDir', () => {
  it('defaults dataDir to .ra under configDir', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-1`)
    mkdirSync(dir, { recursive: true })
    try {
      const c = await loadConfig({ cwd: dir, env: {} })
      expect(c.app.dataDir).toBe(join(dir, '.ra'))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('RA_DATA_DIR overrides dataDir', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-3`)
    mkdirSync(dir, { recursive: true })
    try {
      const c = await loadConfig({ cwd: dir, env: { RA_DATA_DIR: '/custom/data' } })
      expect(c.app.dataDir).toBe('/custom/data')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('config file can set dataDir', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-6`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({ app: { dataDir: 'mydata' } }))
      const c = await loadConfig({ cwd: dir, env: {} })
      expect(c.app.dataDir).toBe(join(dir, 'mydata'))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('tools config', () => {
  it('loads tools.builtin from env var', async () => {
    const config = await loadConfig({ env: { RA_TOOLS_BUILTIN: 'true' } })
    expect(config.agent.tools.builtin).toBe(true)
  })

  it('defaults tools.builtin to true', async () => {
    const config = await loadConfig({ env: {} })
    expect(config.agent.tools.builtin).toBe(true)
  })

  it('loads legacy builtinTools boolean as tools.builtin', async () => {
    const dir = join(tmpdir(), `ra-tools-compat-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({ agent: { builtinTools: false } }))
      const config = await loadConfig({ cwd: dir, env: {} })
      expect(config.agent.tools.builtin).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('loads flat tools config with per-tool overrides', async () => {
    const dir = join(tmpdir(), `ra-tools-flat-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'ra.config.yaml'), [
        'agent:',
        '  tools:',
        '    builtin: true',
        '    Read:',
        '      rootDir: "./src"',
        '    WebFetch:',
        '      enabled: false',
        '    Agent:',
        '      maxConcurrency: 2',
      ].join('\n'))
      const config = await loadConfig({ cwd: dir, env: {} })
      expect(config.agent.tools.builtin).toBe(true)
      expect(config.agent.tools.overrides.Read).toEqual({ rootDir: './src' })
      expect(config.agent.tools.overrides.WebFetch).toEqual({ enabled: false })
      expect(config.agent.tools.overrides.Agent).toEqual({ maxConcurrency: 2 })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('disables individual tools while keeping builtin on', async () => {
    const dir = join(tmpdir(), `ra-tools-disable-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({
        agent: { tools: { builtin: true, DeleteFile: { enabled: false } } },
      }))
      const config = await loadConfig({ cwd: dir, env: {} })
      expect(config.agent.tools.builtin).toBe(true)
      expect(config.agent.tools.overrides.DeleteFile?.enabled).toBe(false)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('toolTimeout config', () => {
  it('RA_TOOL_TIMEOUT sets toolTimeout', async () => {
    const config = await loadConfig({ env: { RA_TOOL_TIMEOUT: '60000' } })
    expect(config.agent.toolTimeout).toBe(60000)
  })
})

describe('thinking config', () => {
  it('rejects invalid RA_THINKING values', async () => {
    const config = await loadConfig({ env: { RA_THINKING: 'extreme' } })
    expect(config.agent.thinking).toBeUndefined()
  })
})

describe('systemPrompt file-path detection', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-sysprompt-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('does NOT try to load plain text as a file path', async () => {
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: 'You are a helpful AI assistant.' } } as any })
    expect(c.agent.systemPrompt).toBe('You are a helpful AI assistant.')
  })

  it('loads systemPrompt from .txt file path', async () => {
    const promptFile = join(tmp, 'custom-prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('You are a pirate.')
  })

  it('loads systemPrompt from .md file path', async () => {
    const promptFile = join(tmp, 'prompt.md')
    writeFileSync(promptFile, '# System\nBe concise.')
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('# System\nBe concise.')
  })

  it('loads systemPrompt from relative path starting with ./', async () => {
    writeFileSync(join(tmp, 'myprompt'), 'Custom prompt text')
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: './myprompt' } } as any })
    expect(c.agent.systemPrompt).toBe('Custom prompt text')
  })

  it('resolves tilde ~ paths for systemPrompt', async () => {
    // We can't easily test actual ~ expansion, but we can verify the code path
    // by checking that a ~ path that doesn't exist is kept as-is
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: '~/nonexistent-ra-test-prompt.txt' } } as any })
    expect(c.agent.systemPrompt).toBe('~/nonexistent-ra-test-prompt.txt')
  })

  it('resolves ../relative paths for systemPrompt', async () => {
    const parentDir = join(tmp, 'parent')
    mkdirSync(parentDir, { recursive: true })
    writeFileSync(join(parentDir, 'prompt.txt'), 'parent prompt')
    const childDir = join(parentDir, 'child')
    mkdirSync(childDir, { recursive: true })
    const c = await loadConfig({ cwd: childDir, cliArgs: { agent: { systemPrompt: '../prompt.txt' } } as any })
    expect(c.agent.systemPrompt).toBe('parent prompt')
  })

  it('resolves relative systemPrompt in config file against config dir, not cwd', async () => {
    // Config file is in parent dir with a relative systemPrompt path
    writeFileSync(join(tmp, 'system.txt'), 'Config-relative prompt')
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { systemPrompt: './system.txt' } }))
    // cwd is a child directory
    const child = join(tmp, 'deep', 'nested')
    mkdirSync(child, { recursive: true })
    const c = await loadConfig({ cwd: child })
    expect(c.agent.systemPrompt).toBe('Config-relative prompt')
  })

  it('keeps string as-is when path-like but file does not exist', async () => {
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: './nonexistent.txt' } } as any })
    expect(c.agent.systemPrompt).toBe('./nonexistent.txt')
  })

  it('resolves tilde paths correctly (~/file expands to homedir/file)', async () => {
    const { homedir } = await import('os')
    const home = homedir()
    const promptFile = join(home, '.ra-test-prompt-tilde.txt')
    writeFileSync(promptFile, 'tilde prompt content')
    try {
      const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: '~/.ra-test-prompt-tilde.txt' } } as any })
      expect(c.agent.systemPrompt).toBe('tilde prompt content')
    } finally {
      rmSync(promptFile, { force: true })
    }
  })
})

describe('config edge cases', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-config-edge-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('empty config file throws during loading', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), '')
    await expect(loadConfig({ cwd: tmp })).rejects.toThrow()
  })

  it('config file with empty JSON object uses all defaults', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), '{}')
    const c = await loadConfig({ cwd: tmp })
    expect(c.agent.provider).toBe('anthropic')
    expect(c.agent.maxIterations).toBe(50)
  })

  it('negative maxIterations from env is accepted as-is', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_MAX_ITERATIONS: '-5' } })
    expect(c.agent.maxIterations).toBe(-5) // no validation — raw parseInt
  })

  it('zero maxIterations from env is accepted', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_MAX_ITERATIONS: '0' } })
    expect(c.agent.maxIterations).toBe(0)
  })

  it('RA_THINKING accepts valid values: low, medium, high', async () => {
    for (const level of ['low', 'medium', 'high']) {
      const c = await loadConfig({ cwd: tmp, env: { RA_THINKING: level } })
      expect(c.agent.thinking).toBe(level as 'low' | 'medium' | 'high')
    }
  })

  it('empty string env vars are set as empty string', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_PROVIDER: '' } })
    // Empty string env var is still coerced and set (no guard)
    expect(c.agent.provider).toBe('' as never)
  })

  it('unknown config keys in file are ignored', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'openai' }, unknownKey: 'value', nested: { deep: true } }))
    const c = await loadConfig({ cwd: tmp })
    expect(c.agent.provider).toBe('openai')
  })

  it('systemPrompt with empty file returns empty string', async () => {
    const promptFile = join(tmp, 'empty.txt')
    writeFileSync(promptFile, '')
    const c = await loadConfig({ cwd: tmp, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('')
  })

  it('CLI args override config file and env simultaneously', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google', model: 'gemini' } }))
    const c = await loadConfig({
      cwd: tmp,
      env: { RA_MODEL: 'gpt-4o' },
      cliArgs: { agent: { provider: 'openai', model: 'gpt-4o-mini' } } as any,
    })
    expect(c.agent.provider).toBe('openai')
    expect(c.agent.model).toBe('gpt-4o-mini') // CLI wins over env
  })
})

describe('legacy flat config migration', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-flat-config-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('migrates flat provider, model, and interface keys', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      provider: 'openai',
      model: 'gpt-4o',
      interface: 'cli',
      maxIterations: 100,
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('openai')
    expect(c.agent.model).toBe('gpt-4o')
    expect(c.app.interface).toBe('cli')
    expect(c.agent.maxIterations).toBe(100)
  })

  it('nested agent section takes priority over flat keys', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'provider: google',
      'agent:',
      '  provider: openai',
    ].join('\n'))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('openai')
  })

  it('migrates flat app keys: skillDirs, permissions, storage', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      skillDirs: ['/custom/skills'],
      logsEnabled: false,
      storage: { format: 'jsonl', maxSessions: 10, ttlDays: 5 },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.skillDirs).toEqual(['/custom/skills'])
    expect(c.app.logsEnabled).toBe(false)
    expect(c.app.storage.maxSessions).toBe(10)
  })

  it('migrates flat providers into app.providers', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'provider: anthropic',
      'providers:',
      '  anthropic:',
      '    apiKey: "sk-ant-flat-key"',
    ].join('\n'))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('anthropic')
    expect(c.app.providers.anthropic.apiKey).toBe('sk-ant-flat-key')
  })

  it('app.providers in YAML works directly', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'app:',
      '  providers:',
      '    anthropic:',
      '      apiKey: "sk-ant-direct"',
      'agent:',
      '  provider: anthropic',
    ].join('\n'))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.providers.anthropic.apiKey).toBe('sk-ant-direct')
  })
})
