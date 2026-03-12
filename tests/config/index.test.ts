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
    expect(c.provider).toBe('anthropic')
    expect(c.interface).toBe('repl')
    expect(c.maxIterations).toBe(50)
    expect(c.skillDirs).toEqual(['.claude/skills', '.agents/skills', '.opencode/skills'])
    expect(c.skills).toEqual([])
  })

  it('includes azure provider defaults', async () => {
    const c = await loadConfig({ cwd: tmp })
    expect(c.providers.azure).toBeDefined()
    expect(c.providers.azure.endpoint).toBe('')
    expect(c.providers.azure.deployment).toBe('')
  })

  it('resolves systemPrompt from file when path exists', async () => {
    const promptFile = join(tmp, 'prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: promptFile } })
    expect(c.systemPrompt).toBe('You are a pirate.')
  })

  it('sets configDir to cwd when no config file is found', async () => {
    const c = await loadConfig({ cwd: tmp })
    expect(c.configDir).toBe(tmp)
  })

  it('sets configDir to directory containing the config file', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google' }))
    const child = join(tmp, 'a', 'b', 'c')
    mkdirSync(child, { recursive: true })
    const c = await loadConfig({ cwd: child })
    expect(c.configDir).toBe(tmp)
  })

  describe('config file formats', () => {
    it('loads JSON', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google', maxIterations: 25 }))
      const c = await loadConfig({ cwd: tmp })
      expect(c.provider).toBe('google')
      expect(c.maxIterations).toBe(25)
    })

    it('loads YAML', async () => {
      writeFileSync(join(tmp, 'ra.config.yaml'), 'provider: ollama\nmodel: llama3\n')
      const c = await loadConfig({ cwd: tmp })
      expect(c.provider).toBe('ollama')
      expect(c.model).toBe('llama3')
    })

    it('loads TOML', async () => {
      writeFileSync(join(tmp, 'ra.config.toml'), 'provider = "openai"\nmaxIterations = 5\n')
      const c = await loadConfig({ cwd: tmp })
      expect(c.provider).toBe('openai')
      expect(c.maxIterations).toBe(5)
    })
  })

  describe('upward directory walking', () => {
    it('finds config in a parent directory', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google' }))
      const child = join(tmp, 'a', 'b', 'c')
      mkdirSync(child, { recursive: true })
      const c = await loadConfig({ cwd: child })
      expect(c.provider).toBe('google')
    })

    it('stops at the first config found while walking up', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google' }))
      const mid = join(tmp, 'a')
      mkdirSync(mid, { recursive: true })
      writeFileSync(join(mid, 'ra.config.json'), JSON.stringify({ provider: 'ollama' }))
      const child = join(mid, 'b')
      mkdirSync(child, { recursive: true })
      const c = await loadConfig({ cwd: child })
      expect(c.provider).toBe('ollama')
    })

    it('prefers config in cwd over parent', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google' }))
      const child = join(tmp, 'sub')
      mkdirSync(child, { recursive: true })
      writeFileSync(join(child, 'ra.config.json'), JSON.stringify({ provider: 'openai' }))
      const c = await loadConfig({ cwd: child })
      expect(c.provider).toBe('openai')
    })
  })

  describe('precedence: defaults < file < env < CLI', () => {
    it('env overrides file', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ provider: 'google' }))
      const c = await loadConfig({ cwd: tmp, env: { RA_PROVIDER: 'openai' } })
      expect(c.provider).toBe('openai')
    })

    it('CLI overrides env', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_PROVIDER: 'google' }, cliArgs: { provider: 'ollama' } })
      expect(c.provider).toBe('ollama')
    })

    it('deep merge preserves sibling keys when one field is overridden', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
        http: { port: 3000, token: 'fromfile' }
      }))
      const c = await loadConfig({ cwd: tmp, env: { RA_HTTP_PORT: '4000' } })
      expect(c.http.port).toBe(4000)
      expect(c.http.token).toBe('fromfile')
    })
  })

  it('ignores non-numeric env var values for integer fields', async () => {
    const c = await loadConfig({ cwd: tmp, env: { RA_MAX_ITERATIONS: 'abc', RA_HTTP_PORT: 'not-a-number' } })
    // Should fall back to defaults, not NaN
    expect(c.maxIterations).toBe(50)
    expect(c.http.port).toBe(3000)
  })

  it('deepMerge: array value in cliArgs replaces array, not merges', async () => {
    // Arrays should be replaced wholesale, not merged
    const c = await loadConfig({
      cwd: tmp,
      cliArgs: { skillDirs: ['/new/dir'] },
    })
    expect(c.skillDirs).toEqual(['/new/dir'])
  })

  it('deepMerge: nested objects are merged, not replaced', async () => {
    // http.port from CLI should not clobber http.token set by env
    const c = await loadConfig({
      cwd: tmp,
      env: { RA_HTTP_TOKEN: 'secret' },
      cliArgs: { http: { port: 9999 } } as any,
    })
    expect(c.http.port).toBe(9999)
    expect(c.http.token).toBe('secret')
  })

  it('deepMerge: null in cliArgs is handled (documents overwrite behavior)', async () => {
    const c = await loadConfig({ cwd: tmp, cliArgs: { http: null } as any })
    expect((c as any).http).toBeNull()
  })

  describe('azure env vars', () => {
    it('RA_AZURE_API_KEY sets providers.azure.apiKey', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_API_KEY: 'my-key' } })
      expect(c.providers.azure.apiKey).toBe('my-key')
    })

    it('RA_AZURE_ENDPOINT sets providers.azure.endpoint', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_ENDPOINT: 'https://myresource.openai.azure.com/' } })
      expect(c.providers.azure.endpoint).toBe('https://myresource.openai.azure.com/')
    })

    it('RA_AZURE_DEPLOYMENT sets providers.azure.deployment', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_DEPLOYMENT: 'my-gpt4o' } })
      expect(c.providers.azure.deployment).toBe('my-gpt4o')
    })

    it('RA_AZURE_API_VERSION sets providers.azure.apiVersion', async () => {
      const c = await loadConfig({ cwd: tmp, env: { RA_AZURE_API_VERSION: '2024-12-01-preview' } })
      expect(c.providers.azure.apiVersion).toBe('2024-12-01-preview')
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
      RA_SKILL_DIRS: '/skills/a,/skills/b', RA_SKILLS: 'code,search',
      RA_ANTHROPIC_API_KEY: 'sk-ant-123', RA_ANTHROPIC_BASE_URL: 'https://ant-proxy/',
      RA_OPENAI_API_KEY: 'sk-oai-123', RA_OPENAI_BASE_URL: 'https://oai-proxy/',
      RA_GOOGLE_API_KEY: 'goog-123', RA_OLLAMA_HOST: 'http://myhost:11434',
    }})
    expect(c.provider).toBe('openai')
    expect(c.model).toBe('gpt-4o')
    expect(c.interface).toBe('http')
    expect(c.systemPrompt).toBe('Be terse')
    expect(c.maxIterations).toBe(99)
    expect(c.http.port).toBe(4000)
    expect(c.http.token).toBe('secret')
    expect(c.mcp.server.enabled).toBe(true)
    expect(c.mcp.server.port).toBe(5001)
    expect(c.mcp.server.tool.name).toBe('mybot')
    expect(c.mcp.server.tool.description).toBe('A bot')
    expect(c.storage.maxSessions).toBe(50)
    expect(c.storage.ttlDays).toBe(7)
    expect(c.skillDirs).toEqual(['/skills/a', '/skills/b'])
    expect(c.skills).toEqual(['code', 'search'])
    expect(c.providers.anthropic.apiKey).toBe('sk-ant-123')
    expect(c.providers.anthropic.baseURL).toBe('https://ant-proxy/')
    expect(c.providers.openai.apiKey).toBe('sk-oai-123')
    expect(c.providers.openai.baseURL).toBe('https://oai-proxy/')
    expect(c.providers.google.apiKey).toBe('goog-123')
    expect(c.providers.ollama.host).toBe('http://myhost:11434')
  })
})

describe('dataDir', () => {
  it('defaults dataDir to .ra under configDir', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-1`)
    mkdirSync(dir, { recursive: true })
    try {
      const c = await loadConfig({ cwd: dir, env: {} })
      expect(c.dataDir).toBe(join(dir, '.ra'))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('RA_DATA_DIR overrides dataDir', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-3`)
    mkdirSync(dir, { recursive: true })
    try {
      const c = await loadConfig({ cwd: dir, env: { RA_DATA_DIR: '/custom/data' } })
      expect(c.dataDir).toBe('/custom/data')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('config file can set dataDir', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-6`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({ dataDir: 'mydata' }))
      const c = await loadConfig({ cwd: dir, env: {} })
      expect(c.dataDir).toBe(join(dir, 'mydata'))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('builtinTools config', () => {
  it('loads builtinTools from env var', async () => {
    const config = await loadConfig({ env: { RA_BUILTIN_TOOLS: 'true' } })
    expect(config.builtinTools).toBe(true)
  })

  it('defaults builtinTools to true', async () => {
    const config = await loadConfig({ env: {} })
    expect(config.builtinTools).toBe(true)
  })
})

describe('builtinSkills config', () => {
  it('defaults builtinSkills to empty object', async () => {
    const config = await loadConfig({ env: {} })
    expect(config.builtinSkills).toEqual({})
  })
})

describe('toolTimeout config', () => {
  it('RA_TOOL_TIMEOUT sets toolTimeout', async () => {
    const config = await loadConfig({ env: { RA_TOOL_TIMEOUT: '60000' } })
    expect(config.toolTimeout).toBe(60000)
  })
})

describe('thinking config', () => {
  it('rejects invalid RA_THINKING values', async () => {
    const config = await loadConfig({ env: { RA_THINKING: 'extreme' } })
    expect(config.thinking).toBeUndefined()
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
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: 'You are a helpful AI assistant.' } })
    expect(c.systemPrompt).toBe('You are a helpful AI assistant.')
  })

  it('loads systemPrompt from .txt file path', async () => {
    const promptFile = join(tmp, 'custom-prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: promptFile } })
    expect(c.systemPrompt).toBe('You are a pirate.')
  })

  it('loads systemPrompt from .md file path', async () => {
    const promptFile = join(tmp, 'prompt.md')
    writeFileSync(promptFile, '# System\nBe concise.')
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: promptFile } })
    expect(c.systemPrompt).toBe('# System\nBe concise.')
  })

  it('loads systemPrompt from relative path starting with ./', async () => {
    writeFileSync(join(tmp, 'myprompt'), 'Custom prompt text')
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: './myprompt' } })
    expect(c.systemPrompt).toBe('Custom prompt text')
  })

  it('resolves tilde ~ paths for systemPrompt', async () => {
    // We can't easily test actual ~ expansion, but we can verify the code path
    // by checking that a ~ path that doesn't exist is kept as-is
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: '~/nonexistent-ra-test-prompt.txt' } })
    expect(c.systemPrompt).toBe('~/nonexistent-ra-test-prompt.txt')
  })

  it('resolves ../relative paths for systemPrompt', async () => {
    const parentDir = join(tmp, 'parent')
    mkdirSync(parentDir, { recursive: true })
    writeFileSync(join(parentDir, 'prompt.txt'), 'parent prompt')
    const childDir = join(parentDir, 'child')
    mkdirSync(childDir, { recursive: true })
    const c = await loadConfig({ cwd: childDir, cliArgs: { systemPrompt: '../prompt.txt' } })
    expect(c.systemPrompt).toBe('parent prompt')
  })

  it('resolves relative systemPrompt in config file against config dir, not cwd', async () => {
    // Config file is in parent dir with a relative systemPrompt path
    writeFileSync(join(tmp, 'system.txt'), 'Config-relative prompt')
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ systemPrompt: './system.txt' }))
    // cwd is a child directory
    const child = join(tmp, 'deep', 'nested')
    mkdirSync(child, { recursive: true })
    const c = await loadConfig({ cwd: child })
    expect(c.systemPrompt).toBe('Config-relative prompt')
  })

  it('keeps string as-is when path-like but file does not exist', async () => {
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: './nonexistent.txt' } })
    expect(c.systemPrompt).toBe('./nonexistent.txt')
  })

  it('resolves tilde paths correctly (~/file expands to homedir/file)', async () => {
    const { homedir } = await import('os')
    const home = homedir()
    const promptFile = join(home, '.ra-test-prompt-tilde.txt')
    writeFileSync(promptFile, 'tilde prompt content')
    try {
      const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: '~/.ra-test-prompt-tilde.txt' } })
      expect(c.systemPrompt).toBe('tilde prompt content')
    } finally {
      rmSync(promptFile, { force: true })
    }
  })
})
