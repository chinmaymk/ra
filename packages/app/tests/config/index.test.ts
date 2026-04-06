import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig, ConfigError } from '../../src/config'
import { configHandle, homeDir } from '../../src/utils/paths'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'

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
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('anthropic')
    expect(c.app.interface).toBe('repl')
    expect(c.agent.maxIterations).toBe(0)
    expect(c.agent.skillDirs).toEqual(['.claude/skills', '.agents/skills', '.opencode/skills'])
  })

  it('includes azure provider defaults', async () => {
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.providers.azure).toBeDefined()
    expect(c.app.providers.azure.endpoint).toBe('')
    expect(c.app.providers.azure.deployment).toBe('')
  })

  it('resolves systemPrompt from file when path exists', async () => {
    const promptFile = join(tmp, 'prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('You are a pirate.')
  })

  it('sets configDir to cwd when no config file is found', async () => {
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.configDir).toBe(tmp)
  })

  it('sets configDir to directory containing the config file', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
    const child = join(tmp, 'a', 'b', 'c')
    mkdirSync(child, { recursive: true })
    const c = await loadConfig({ cwd: child, env: {} })
    expect(c.app.configDir).toBe(tmp)
  })

  describe('config file formats', () => {
    it('loads JSON', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google', maxIterations: 25 } }))
      const c = await loadConfig({ cwd: tmp, env: {} })
      expect(c.agent.provider).toBe('google')
      expect(c.agent.maxIterations).toBe(25)
    })

    it('loads YAML', async () => {
      writeFileSync(join(tmp, 'ra.config.yaml'), 'agent:\n  provider: ollama\n  model: llama3\n')
      const c = await loadConfig({ cwd: tmp, env: {} })
      expect(c.agent.provider).toBe('ollama')
      expect(c.agent.model).toBe('llama3')
    })

    it('loads TOML', async () => {
      writeFileSync(join(tmp, 'ra.config.toml'), '[agent]\nprovider = "openai"\nmaxIterations = 5\n')
      const c = await loadConfig({ cwd: tmp, env: {} })
      expect(c.agent.provider).toBe('openai')
      expect(c.agent.maxIterations).toBe(5)
    })
  })

  describe('upward directory walking', () => {
    it('finds config in a parent directory', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const child = join(tmp, 'a', 'b', 'c')
      mkdirSync(child, { recursive: true })
      const c = await loadConfig({ cwd: child, env: {} })
      expect(c.agent.provider).toBe('google')
    })

    it('stops at the first config found while walking up', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const mid = join(tmp, 'a')
      mkdirSync(mid, { recursive: true })
      writeFileSync(join(mid, 'ra.config.json'), JSON.stringify({ agent: { provider: 'ollama' } }))
      const child = join(mid, 'b')
      mkdirSync(child, { recursive: true })
      const c = await loadConfig({ cwd: child, env: {} })
      expect(c.agent.provider).toBe('ollama')
    })

    it('prefers config in cwd over parent', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const child = join(tmp, 'sub')
      mkdirSync(child, { recursive: true })
      writeFileSync(join(child, 'ra.config.json'), JSON.stringify({ agent: { provider: 'openai' } }))
      const c = await loadConfig({ cwd: child, env: {} })
      expect(c.agent.provider).toBe('openai')
    })
  })

  describe('precedence: defaults < file < CLI', () => {
    it('file overrides defaults', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const c = await loadConfig({ cwd: tmp, env: {} })
      expect(c.agent.provider).toBe('google')
    })

    it('CLI overrides file', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google' } }))
      const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { provider: 'ollama' } } as any })
      expect(c.agent.provider).toBe('ollama')
    })

    it('deep merge preserves sibling keys when one field is overridden by CLI', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
        app: { http: { port: 4000, token: 'fromfile' } }
      }))
      const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { app: { http: { port: 9999 } } } as any })
      expect(c.app.http.port).toBe(9999)
      expect(c.app.http.token).toBe('fromfile')
    })
  })

  it('deepMerge: array value in cliArgs replaces array, not merges', async () => {
    const c = await loadConfig({
      cwd: tmp,
      env: {},
      cliArgs: { agent: { skillDirs: ['/new/dir'] } } as any,
    })
    expect(c.agent.skillDirs).toEqual(['/new/dir'])
  })

  it('deepMerge: nested objects are merged, not replaced', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: { http: { token: 'secret' } }
    }))
    const c = await loadConfig({
      cwd: tmp,
      env: {},
      cliArgs: { app: { http: { port: 9999 } } } as any,
    })
    expect(c.app.http.port).toBe(9999)
    expect(c.app.http.token).toBe('secret')
  })

  it('deepMerge: null in cliArgs is handled (documents overwrite behavior)', async () => {
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { app: { http: null } } as any })
    expect((c.app as any).http).toBeNull()
  })

  it('deepMerge: __proto__ keys are ignored to prevent prototype pollution', async () => {
    const malicious = JSON.parse('{"agent":{"__proto__":{"polluted":true}}}')
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: malicious })
    expect(({} as any).polluted).toBeUndefined()
    expect((c.agent as any).__proto__.polluted).toBeUndefined()
  })

  describe('provider credentials via standard env vars', () => {
    it('ANTHROPIC_API_KEY resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { ANTHROPIC_API_KEY: 'sk-ant-123' } })
      expect(c.app.providers.anthropic.apiKey).toBe('sk-ant-123')
    })

    it('OPENAI_API_KEY resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { OPENAI_API_KEY: 'sk-oai-123' } })
      expect(c.app.providers.openai.apiKey).toBe('sk-oai-123')
    })

    it('GOOGLE_API_KEY resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { GOOGLE_API_KEY: 'goog-123' } })
      expect(c.app.providers.google.apiKey).toBe('goog-123')
    })

    it('OLLAMA_HOST resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { OLLAMA_HOST: 'http://myhost:11434' } })
      expect(c.app.providers.ollama.host).toBe('http://myhost:11434')
    })

    it('AZURE_OPENAI_API_KEY resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { AZURE_OPENAI_API_KEY: 'my-key' } })
      expect(c.app.providers.azure.apiKey).toBe('my-key')
    })

    it('AZURE_OPENAI_ENDPOINT resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { AZURE_OPENAI_ENDPOINT: 'https://myresource.openai.azure.com/' } })
      expect(c.app.providers.azure.endpoint).toBe('https://myresource.openai.azure.com/')
    })

    it('AZURE_OPENAI_DEPLOYMENT resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { AZURE_OPENAI_DEPLOYMENT: 'my-gpt4o' } })
      expect(c.app.providers.azure.deployment).toBe('my-gpt4o')
    })

    it('AWS_REGION resolves in defaults', async () => {
      const c = await loadConfig({ cwd: tmp, env: { AWS_REGION: 'eu-west-1' } })
      expect(c.app.providers.bedrock.region).toBe('eu-west-1')
    })

    it('config file provider overrides env-resolved defaults', async () => {
      writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
        app: { providers: { anthropic: { apiKey: 'from-file' } } }
      }))
      const c = await loadConfig({ cwd: tmp, env: { ANTHROPIC_API_KEY: 'from-env' } })
      expect(c.app.providers.anthropic.apiKey).toBe('from-file')
    })
  })
})

describe('dataDir', () => {
  it('defaults dataDir to centralized ~/.ra/<handle>', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-1`)
    mkdirSync(dir, { recursive: true })
    try {
      const c = await loadConfig({ cwd: dir, env: {} })
      expect(c.app.dataDir).toBe(join(homeDir(), '.ra', configHandle(dir)))
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

  it('${} interpolation works for dataDir in config', async () => {
    const dir = join(tmpdir(), `ra-datadir-test-${Date.now()}-7`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(join(dir, 'ra.config.json'), JSON.stringify({ app: { dataDir: '${CUSTOM_DATA_DIR:-mydata}' } }))
      const c = await loadConfig({ cwd: dir, env: { CUSTOM_DATA_DIR: '/custom/data' } })
      expect(c.app.dataDir).toBe('/custom/data')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('tools config', () => {
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

describe('type coercion after interpolation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-coerce-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('coerces string to number for integer fields', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { maxIterations: '${MAX_ITERS:-99}' },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.maxIterations).toBe(99)
    expect(typeof c.agent.maxIterations).toBe('number')
  })

  it('coerces string to number when env var provides the value', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: { http: { port: '${PORT}' } },
    }))
    const c = await loadConfig({ cwd: tmp, env: { PORT: '4000' } })
    expect(c.app.http.port).toBe(4000)
    expect(typeof c.app.http.port).toBe('number')
  })

  it('coerces string to boolean for boolean fields', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { tools: { builtin: '${BUILTIN:-true}' } },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.tools.builtin).toBe(true)
    expect(typeof c.agent.tools.builtin).toBe('boolean')
  })

  it('coerces "false" string to boolean false', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: { logsEnabled: '${LOGS:-false}' },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.logsEnabled).toBe(false)
  })

  it('numbers from env vars are coerced correctly', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { maxIterations: '${ITERS}' },
    }))
    const c = await loadConfig({ cwd: tmp, env: { ITERS: '5' } })
    expect(c.agent.maxIterations).toBe(5)
  })

  it('zero is coerced correctly', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { maxIterations: '${ITERS}' },
    }))
    const c = await loadConfig({ cwd: tmp, env: { ITERS: '0' } })
    expect(c.agent.maxIterations).toBe(0)
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
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: 'You are a helpful AI assistant.' } } as any })
    expect(c.agent.systemPrompt).toBe('You are a helpful AI assistant.')
  })

  it('loads systemPrompt from .txt file path', async () => {
    const promptFile = join(tmp, 'custom-prompt.txt')
    writeFileSync(promptFile, 'You are a pirate.')
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('You are a pirate.')
  })

  it('loads systemPrompt from .md file path', async () => {
    const promptFile = join(tmp, 'prompt.md')
    writeFileSync(promptFile, '# System\nBe concise.')
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('# System\nBe concise.')
  })

  it('loads systemPrompt from relative path starting with ./', async () => {
    writeFileSync(join(tmp, 'myprompt'), 'Custom prompt text')
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: './myprompt' } } as any })
    expect(c.agent.systemPrompt).toBe('Custom prompt text')
  })

  it('resolves tilde ~ paths for systemPrompt', async () => {
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: '~/nonexistent-ra-test-prompt.txt' } } as any })
    expect(c.agent.systemPrompt).toBe('~/nonexistent-ra-test-prompt.txt')
  })

  it('resolves ../relative paths for systemPrompt', async () => {
    const parentDir = join(tmp, 'parent')
    mkdirSync(parentDir, { recursive: true })
    writeFileSync(join(parentDir, 'prompt.txt'), 'parent prompt')
    const childDir = join(parentDir, 'child')
    mkdirSync(childDir, { recursive: true })
    const c = await loadConfig({ cwd: childDir, env: {}, cliArgs: { agent: { systemPrompt: '../prompt.txt' } } as any })
    expect(c.agent.systemPrompt).toBe('parent prompt')
  })

  it('resolves relative systemPrompt in config file against config dir, not cwd', async () => {
    writeFileSync(join(tmp, 'system.txt'), 'Config-relative prompt')
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { systemPrompt: './system.txt' } }))
    const child = join(tmp, 'deep', 'nested')
    mkdirSync(child, { recursive: true })
    const c = await loadConfig({ cwd: child, env: {} })
    expect(c.agent.systemPrompt).toBe('Config-relative prompt')
  })

  it('keeps string as-is when path-like but file does not exist', async () => {
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: './nonexistent.txt' } } as any })
    expect(c.agent.systemPrompt).toBe('./nonexistent.txt')
  })

  it('resolves tilde paths correctly (~/file expands to homedir/file)', async () => {
    const { homedir } = await import('os')
    const home = homedir()
    const promptFile = join(home, '.ra-test-prompt-tilde.txt')
    writeFileSync(promptFile, 'tilde prompt content')
    try {
      const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: '~/.ra-test-prompt-tilde.txt' } } as any })
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

  it('empty config file throws ConfigError', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), '')
    await expect(loadConfig({ cwd: tmp })).rejects.toThrow('Config file is empty')
  })

  it('config file with empty JSON object uses all defaults', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), '{}')
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('anthropic')
    expect(c.agent.maxIterations).toBe(0)
  })

  it('unknown config keys in file are ignored', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'openai' }, unknownKey: 'value', nested: { deep: true } }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('openai')
  })

  it('systemPrompt with empty file returns empty string', async () => {
    const promptFile = join(tmp, 'empty.txt')
    writeFileSync(promptFile, '')
    const c = await loadConfig({ cwd: tmp, env: {}, cliArgs: { agent: { systemPrompt: promptFile } } as any })
    expect(c.agent.systemPrompt).toBe('')
  })

  it('CLI args override config file', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'google', model: 'gemini' } }))
    const c = await loadConfig({
      cwd: tmp,
      env: {},
      cliArgs: { agent: { provider: 'openai', model: 'gpt-4o-mini' } } as any,
    })
    expect(c.agent.provider).toBe('openai')
    expect(c.agent.model).toBe('gpt-4o-mini')
  })
})

describe('env var interpolation in config files', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-config-interp-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('resolves ${VAR} in config file values', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'app:',
      '  providers:',
      '    anthropic:',
      '      apiKey: "${MY_API_KEY}"',
    ].join('\n'))
    const c = await loadConfig({ cwd: tmp, env: { MY_API_KEY: 'sk-test-123' } })
    expect(c.app.providers.anthropic.apiKey).toBe('sk-test-123')
  })

  it('resolves ${VAR:-default} with fallback when var is unset', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'agent:',
      '  model: "${MODEL:-claude-sonnet-4-6}"',
    ].join('\n'))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.model).toBe('claude-sonnet-4-6')
  })

  it('resolves ${VAR:-default} with env value when var is set', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'agent:',
      '  model: "${MODEL:-claude-sonnet-4-6}"',
    ].join('\n'))
    const c = await loadConfig({ cwd: tmp, env: { MODEL: 'gpt-4o' } })
    expect(c.agent.model).toBe('gpt-4o')
  })

  it('resolves variables in MCP client env blocks', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'app:',
      '  mcp:',
      '    client:',
      '      - name: github',
      '        transport: stdio',
      '        command: npx',
      '        args: ["-y", "@modelcontextprotocol/server-github"]',
      '        env:',
      '          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"',
    ].join('\n'))
    const c = await loadConfig({ cwd: tmp, env: { GITHUB_TOKEN: 'ghp_abc123' } })
    expect(c.app.mcpServers[0]?.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_abc123')
  })

  it('throws when a required variable is missing', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), [
      'app:',
      '  providers:',
      '    anthropic:',
      '      apiKey: "${REQUIRED_KEY}"',
    ].join('\n'))
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow(
      'Environment variable "REQUIRED_KEY" is required but not set'
    )
  })

  it('resolves ${VAR-default} keeping empty string when var is empty', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { systemPrompt: '${EMPTY_VAR-fallback}' },
    }))
    const c = await loadConfig({ cwd: tmp, env: { EMPTY_VAR: '' } })
    expect(c.agent.systemPrompt).toBe('')
  })

  it('leaves strings without ${} patterns untouched', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('anthropic')
    expect(c.agent.model).toBe('claude-sonnet-4-6')
  })

  it('resolves multiple variables in one string', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: { providers: { azure: { endpoint: 'https://${AZURE_HOST}:${AZURE_PORT}/v1' } } },
    }))
    const c = await loadConfig({ cwd: tmp, env: { AZURE_HOST: 'myresource.openai.azure.com', AZURE_PORT: '443' } })
    expect(c.app.providers.azure.endpoint).toBe('https://myresource.openai.azure.com:443/v1')
  })
})

describe('MCP config', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-mcp-config-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('defaults mcpServers to empty array and mcpLazySchemas to true', async () => {
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.mcpServers).toEqual([])
    expect(c.app.mcpLazySchemas).toBe(true)
  })

  it('loads canonical app.mcpServers config', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: {
        mcpServers: [{ name: 'test', transport: 'stdio', command: 'echo' }],
        mcpLazySchemas: false,
      },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.mcpServers).toEqual([{ name: 'test', transport: 'stdio', command: 'echo' }])
    expect(c.app.mcpLazySchemas).toBe(false)
  })

  it('migrates legacy agent.mcp.servers to app.mcpServers', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: {
        mcp: {
          servers: [{ name: 'legacy', transport: 'stdio', command: 'echo' }],
          lazySchemas: false,
        },
      },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.mcpServers).toEqual([{ name: 'legacy', transport: 'stdio', command: 'echo' }])
    expect(c.app.mcpLazySchemas).toBe(false)
  })

  it('migrates legacy app.mcp.client to app.mcpServers', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: { mcp: { client: [{ name: 'old', transport: 'sse', url: 'http://localhost' }] } },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.mcpServers).toEqual([{ name: 'old', transport: 'sse', url: 'http://localhost' }])
  })

  it('migrates legacy app.mcpServer to app.raMcpServer', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: { mcpServer: { enabled: true, port: 4000, tool: { name: 'bot', description: 'A bot' } } },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.raMcpServer.enabled).toBe(true)
    expect(c.app.raMcpServer.port).toBe(4000)
    expect(c.app.raMcpServer.tool.name).toBe('bot')
  })

  it('canonical app.mcpServers takes priority over legacy agent.mcp.servers', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      app: { mcpServers: [{ name: 'canonical', transport: 'stdio', command: 'a' }] },
      agent: { mcp: { servers: [{ name: 'legacy', transport: 'stdio', command: 'b' }] } },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.app.mcpServers).toEqual([{ name: 'canonical', transport: 'stdio', command: 'a' }])
  })
})

describe('recipe resolution', () => {
  let tmp: string
  let recipeDir: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-recipe-config-${Date.now()}`)
    recipeDir = join(tmp, 'recipes', 'testuser', 'my-recipe')
    mkdirSync(recipeDir, { recursive: true })
    writeFileSync(join(recipeDir, 'ra.config.yaml'), [
      'agent:',
      '  provider: openai',
      '  model: gpt-4o',
      '  maxIterations: 100',
      '  skillDirs:',
      '    - ./skills',
    ].join('\n'))
    // Create a skills dir in the recipe
    mkdirSync(join(recipeDir, 'skills'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('loads recipe via recipeName option (local path)', async () => {
    const c = await loadConfig({ cwd: tmp, env: {}, recipeName: recipeDir })
    expect(c.agent.provider).toBe('openai')
    expect(c.agent.model).toBe('gpt-4o')
    expect(c.agent.maxIterations).toBe(100)
  })

  it('recipe skillDirs are pre-resolved to absolute paths', async () => {
    const c = await loadConfig({ cwd: tmp, env: {}, recipeName: recipeDir })
    expect(c.agent.skillDirs.some(d => d === join(recipeDir, 'skills'))).toBe(true)
  })

  it('recipe skillDirs are prepended to default skillDirs', async () => {
    const c = await loadConfig({ cwd: tmp, env: {}, recipeName: recipeDir })
    // Recipe dir comes first, defaults come after
    expect(c.agent.skillDirs[0]).toBe(join(recipeDir, 'skills'))
    expect(c.agent.skillDirs.length).toBeGreaterThan(1)
  })

  it('local config file overrides recipe values', async () => {
    const projectDir = join(tmp, 'project')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'ra.config.yaml'), [
      'agent:',
      '  recipe: ' + recipeDir,
      '  model: custom-model',
    ].join('\n'))
    const c = await loadConfig({ cwd: projectDir, env: {} })
    expect(c.agent.provider).toBe('openai')  // from recipe
    expect(c.agent.model).toBe('custom-model')  // overridden by local
  })

  it('CLI args override recipe values', async () => {
    const c = await loadConfig({
      cwd: tmp,
      env: {},
      recipeName: recipeDir,
      cliArgs: { agent: { model: 'cli-model' } } as any,
    })
    expect(c.agent.model).toBe('cli-model')
  })

  it('throws when recipe not found', async () => {
    await expect(loadConfig({ cwd: tmp, env: {}, recipeName: 'nonexistent/recipe' }))
      .rejects.toThrow('Recipe not found')
  })

  it('recipe field is stripped from final config', async () => {
    const projectDir = join(tmp, 'project2')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'ra.config.yaml'), [
      'agent:',
      '  recipe: ' + recipeDir,
    ].join('\n'))
    const c = await loadConfig({ cwd: projectDir, env: {} })
    expect(c.agent.recipe).toBeUndefined()
  })

  it('recipeName from CLI takes priority over config file recipe field', async () => {
    const otherRecipe = join(tmp, 'recipes', 'other', 'recipe')
    mkdirSync(otherRecipe, { recursive: true })
    writeFileSync(join(otherRecipe, 'ra.config.yaml'), 'agent:\n  provider: google\n')

    const projectDir = join(tmp, 'project3')
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, 'ra.config.yaml'), [
      'agent:',
      '  recipe: ' + recipeDir,
    ].join('\n'))

    const c = await loadConfig({ cwd: projectDir, env: {}, recipeName: otherRecipe })
    expect(c.agent.provider).toBe('google')  // from CLI recipe, not config file recipe
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

  it('coerces interpolated values in flat keys after migration', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      maxIterations: '${ITERS:-25}',
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.maxIterations).toBe(25)
    expect(typeof c.agent.maxIterations).toBe('number')
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

  it('migrates flat agent keys: skillDirs, permissions', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      skillDirs: ['/custom/skills'],
      logsEnabled: false,
      storage: { format: 'jsonl', maxSessions: 10, ttlDays: 5 },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.skillDirs).toEqual(['/custom/skills'])
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

describe('config validation', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-config-validate-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('rejects invalid provider name', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { provider: 'invalid-provider' } }))
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow(ConfigError)
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow('not a valid provider')
  })

  it('rejects invalid interface', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ app: { interface: 'websocket' } }))
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow(ConfigError)
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow('not valid')
  })

  it('rejects negative maxIterations', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { maxIterations: -1 } }))
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow('maxIterations')
  })

  it('rejects compaction threshold outside 0-1 range', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ agent: { compaction: { threshold: 2.0 } } }))
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow('threshold')
  })

  it('rejects invalid HTTP port', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({ app: { http: { port: 99999 } } }))
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow('port')
  })

  it('reports invalid JSON with file path and parse detail', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), '{ invalid json }')
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow('Invalid JSON')
  })

  it('reports invalid YAML with file path and parse detail', async () => {
    writeFileSync(join(tmp, 'ra.config.yaml'), 'agent:\n  provider: "unclosed')
    await expect(loadConfig({ cwd: tmp, env: {} })).rejects.toThrow('Invalid YAML')
  })

  it('accepts valid config without errors', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { provider: 'openai', model: 'gpt-4o', maxIterations: 10 },
      app: { interface: 'cli' },
    }))
    const c = await loadConfig({ cwd: tmp, env: {} })
    expect(c.agent.provider).toBe('openai')
  })

  it('collects multiple validation errors into one message', async () => {
    writeFileSync(join(tmp, 'ra.config.json'), JSON.stringify({
      agent: { provider: 'bad', maxRetries: -5 },
    }))
    try {
      await loadConfig({ cwd: tmp, env: {} })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      const msg = (err as ConfigError).message
      expect(msg).toContain('not a valid provider')
      expect(msg).toContain('maxRetries')
    }
  })
})
