import { describe, it, expect } from 'bun:test'
import { parseArgs } from '../../src/interfaces/parse-args'

function dev(...args: string[]): string[] {
  return ['bun', 'src/index.ts', ...args]
}

function bin(...args: string[]): string[] {
  return ['/usr/local/bin/ra', ...args]
}

describe('parseArgs', () => {
  describe('offset detection', () => {
    it('skips 2 tokens when argv[1] is a .ts file (dev mode)', () => {
      expect(parseArgs(dev('hello')).meta.prompt).toBe('hello')
    })

    it('skips 1 token when argv[0] is a compiled binary', () => {
      expect(parseArgs(bin('hello')).meta.prompt).toBe('hello')
    })

    it('handles .js and .mjs source extensions', () => {
      expect(parseArgs(['node', 'src/index.js', 'hi']).meta.prompt).toBe('hi')
      expect(parseArgs(['node', 'src/index.mjs', 'hi']).meta.prompt).toBe('hi')
    })
  })

  describe('interface flags → config.interface', () => {
    it('--http sets http', () => expect(parseArgs(dev('--http')).config.interface).toBe('http'))
    it('--repl sets repl', () => expect(parseArgs(dev('--repl')).config.interface).toBe('repl'))
    it('--repl with positional prompt preserves repl interface', () => {
      const result = parseArgs(['bun', 'src/index.ts', '--repl', 'hello world'])
      expect(result.config.interface).toBe('repl')
      expect(result.meta.prompt).toBe('hello world')
    })
    it('--cli sets cli',   () => expect(parseArgs(dev('--cli', 'x')).config.interface).toBe('cli'))
    it('--mcp sets mcp',   () => expect(parseArgs(dev('--mcp')).config.interface).toBe('mcp'))
    it('mcp takes precedence over http when both given', () => {
      expect(parseArgs(dev('--mcp', '--http')).config.interface).toBe('mcp')
    })
    it('no flag leaves interface undefined', () => {
      expect(parseArgs(dev('--model', 'x')).config.interface).toBeUndefined()
    })
  })

  describe('top-level config flags', () => {
    it('--provider', () => expect(parseArgs(dev('--provider', 'openai')).config.provider).toBe('openai'))
    it('--model',    () => expect(parseArgs(dev('--model', 'gpt-4o')).config.model).toBe('gpt-4o'))
    it('--system-prompt', () => expect(parseArgs(dev('--system-prompt', 'Be helpful')).config.systemPrompt).toBe('Be helpful'))
    it('--max-iterations', () => expect(parseArgs(dev('--max-iterations', '20')).config.maxIterations).toBe(20))
    it('--tool-timeout', () => expect(parseArgs(dev('--tool-timeout', '15000')).config.toolTimeout).toBe(15000))
    it('parses --builtin-tools flag', () => {
      const result = parseArgs(['node', 'ra.ts', '--builtin-tools'])
      expect(result.config.builtinTools).toBe(true)
    })
    it('parses --thinking flag', () => {
      const result = parseArgs(['node', 'ra.ts', '--thinking', 'high'])
      expect(result.config.thinking).toBe('high')
    })
  })

  describe('HTTP server flags', () => {
    it('--http-port sets config.http.port', () => {
      expect(parseArgs(dev('--http-port', '4000')).config.http?.port).toBe(4000)
    })
    it('--http-token sets config.http.token', () => {
      expect(parseArgs(dev('--http-token', 'secret')).config.http?.token).toBe('secret')
    })
    it('--http-port does not set token', () => {
      expect(parseArgs(dev('--http-port', '4000')).config.http?.token).toBeUndefined()
    })
    it('--http-token does not set port', () => {
      expect(parseArgs(dev('--http-token', 'secret')).config.http?.port).toBeUndefined()
    })
  })

  describe('MCP server flags', () => {
    it('--mcp-server-enabled', () => {
      expect(parseArgs(dev('--mcp-server-enabled')).config.mcp?.server.enabled).toBe(true)
    })
    it('--mcp-server-port', () => {
      expect(parseArgs(dev('--mcp-server-port', '4001')).config.mcp?.server.port).toBe(4001)
    })
    it('--mcp-stdio sets mcp-stdio', () => {
      expect(parseArgs(dev('--mcp-stdio')).config.interface).toBe('mcp-stdio')
    })
    it('--mcp-server-tool-name', () => {
      expect(parseArgs(dev('--mcp-server-tool-name', 'mybot')).config.mcp?.server.tool.name).toBe('mybot')
    })
    it('--mcp-server-tool-description', () => {
      expect(parseArgs(dev('--mcp-server-tool-description', 'A bot')).config.mcp?.server.tool.description).toBe('A bot')
    })
    it('individual MCP flags do not clobber siblings', () => {
      const r = parseArgs(dev('--mcp-server-port', '5000'))
      expect(r.config.mcp?.server.port).toBe(5000)
      expect(r.config.mcp?.server.enabled).toBeUndefined()
    })
  })

  describe('data-dir and storage flags', () => {
    it('--data-dir', () => {
      expect(parseArgs(dev('--data-dir', '/tmp/data')).config.dataDir).toBe('/tmp/data')
    })
    it('--storage-max-sessions', () => {
      expect(parseArgs(dev('--storage-max-sessions', '50')).config.storage?.maxSessions).toBe(50)
    })
    it('--storage-ttl-days', () => {
      expect(parseArgs(dev('--storage-ttl-days', '7')).config.storage?.ttlDays).toBe(7)
    })
    it('individual storage flags do not clobber siblings', () => {
      const r = parseArgs(dev('--storage-max-sessions', '50'))
      expect(r.config.storage?.maxSessions).toBe(50)
      expect(r.config.storage?.ttlDays).toBeUndefined()
    })
  })

  describe('provider connection flags', () => {
    it('--anthropic-base-url', () => {
      expect(parseArgs(dev('--anthropic-base-url', 'https://proxy/')).config.providers?.anthropic.baseURL).toBe('https://proxy/')
    })
    it('--openai-base-url', () => {
      expect(parseArgs(dev('--openai-base-url', 'https://proxy/')).config.providers?.openai.baseURL).toBe('https://proxy/')
    })
    it('--ollama-host', () => {
      expect(parseArgs(dev('--ollama-host', 'http://localhost:11434')).config.providers?.ollama.host).toBe('http://localhost:11434')
    })
  })

  describe('skills flags', () => {
    it('--skill-dir sets config.skillDirs', () => {
      expect(parseArgs(dev('--skill-dir', '/skills/a')).config.skillDirs).toEqual(['/skills/a'])
    })
    it('--skill-dir is repeatable', () => {
      expect(parseArgs(dev('--skill-dir', '/a', '--skill-dir', '/b')).config.skillDirs).toEqual(['/a', '/b'])
    })
    it('--skill sets meta.skills (not config.skills)', () => {
      const r = parseArgs(dev('--skill', 'code'))
      expect(r.meta.skills).toEqual(['code'])
      expect((r.config as Record<string, unknown>).skills).toBeUndefined()
    })
  })

  describe('meta fields', () => {
    it('--config → meta.configPath', () => {
      expect(parseArgs(dev('--config', '/etc/ra.yaml')).meta.configPath).toBe('/etc/ra.yaml')
    })
    it('--resume → meta.resume', () => {
      expect(parseArgs(dev('--resume', 'sess-123')).meta.resume).toBe('sess-123')
    })
    it('--help → meta.help', () => expect(parseArgs(dev('--help')).meta.help).toBe(true))
    it('-h → meta.help',     () => expect(parseArgs(dev('-h')).meta.help).toBe(true))
    it('defaults meta.help to false', () => expect(parseArgs(dev()).meta.help).toBe(false))
    it('parses --show-context flag', () => {
      const result = parseArgs(['bun', 'src/index.ts', '--show-context'])
      expect(result.meta.showContext).toBe(true)
    })
    it('parses --dry-run-config flag', () => {
      const result = parseArgs(['bun', 'src/index.ts', '--dry-run-config'])
      expect(result.meta.dryRunConfig).toBe(true)
    })
    it('defaults dryRunConfig to false', () => {
      expect(parseArgs(dev()).meta.dryRunConfig).toBe(false)
    })
    it('multiple --skill flags', () => {
      expect(parseArgs(dev('--skill', 'code', '--skill', 'search')).meta.skills).toEqual(['code', 'search'])
    })
    it('multiple --file flags', () => {
      expect(parseArgs(dev('--file', 'a.txt', '--file', 'b.pdf')).meta.files).toEqual(['a.txt', 'b.pdf'])
    })
    it('positional → meta.prompt', () => {
      expect(parseArgs(dev('hello')).meta.prompt).toBe('hello')
    })
    it('multiple positionals joined', () => {
      expect(parseArgs(dev('hello', 'world')).meta.prompt).toBe('hello world')
    })
    it('no positionals → undefined prompt', () => {
      expect(parseArgs(dev('--provider', 'openai')).meta.prompt).toBeUndefined()
    })
  })

  describe('Azure provider flags', () => {
    it('--azure-endpoint sets providers.azure.endpoint', () => {
      const r = parseArgs(dev('--azure-endpoint', 'https://myresource.openai.azure.com/'))
      expect((r.config as any).providers?.azure?.endpoint).toBe('https://myresource.openai.azure.com/')
    })

    it('--azure-deployment sets providers.azure.deployment', () => {
      const r = parseArgs(dev('--azure-deployment', 'my-gpt4o'))
      expect((r.config as any).providers?.azure?.deployment).toBe('my-gpt4o')
    })
  })

  describe('skill subcommands', () => {
    it('parses "skill install <source>"', () => {
      const r = parseArgs(dev('skill', 'install', 'code-review'))
      expect(r.meta.skillCommand).toEqual({ action: 'install', args: ['code-review'] })
    })

    it('parses "skill install" with multiple sources', () => {
      const r = parseArgs(dev('skill', 'install', 'review', 'lint'))
      expect(r.meta.skillCommand).toEqual({ action: 'install', args: ['review', 'lint'] })
    })

    it('parses "skill remove <name>"', () => {
      const r = parseArgs(dev('skill', 'remove', 'review'))
      expect(r.meta.skillCommand).toEqual({ action: 'remove', args: ['review'] })
    })

    it('parses "skill list"', () => {
      const r = parseArgs(dev('skill', 'list'))
      expect(r.meta.skillCommand).toEqual({ action: 'list', args: [] })
    })

    it('does not treat "skill" without subcommand as skill command', () => {
      const r = parseArgs(dev('skill'))
      expect(r.meta.skillCommand).toBeUndefined()
      expect(r.meta.prompt).toBe('skill')
    })
  })

  describe('edge cases', () => {
    it('empty argv', () => {
      const r = parseArgs(['ra'])
      expect(r.meta.prompt).toBeUndefined()
      expect(r.meta.help).toBe(false)
      expect(r.config.interface).toBeUndefined()
    })

    it('flags after prompt', () => {
      const r = parseArgs(dev('my prompt', '--provider', 'openai'))
      expect(r.meta.prompt).toBe('my prompt')
      expect(r.config.provider).toBe('openai')
    })

    it('ignores non-numeric --max-iterations', () => {
      const r = parseArgs(dev('--max-iterations', 'abc'))
      expect(r.config.maxIterations).toBeUndefined()
    })

    it('ignores non-numeric --http-port', () => {
      const r = parseArgs(dev('--http-port', 'not-a-number'))
      expect(r.config.http?.port).toBeUndefined()
    })

    it('ignores non-numeric --storage-max-sessions', () => {
      const r = parseArgs(dev('--storage-max-sessions', 'xyz'))
      expect(r.config.storage?.maxSessions).toBeUndefined()
    })

    it('all MCP server fields together', () => {
      const r = parseArgs(dev(
        '--mcp-server-enabled',
        '--mcp-server-port', '5000',
        '--mcp-server-tool-name', 'ra',
        '--mcp-server-tool-description', 'My agent',
      ))
      expect(r.config.mcp?.server.enabled).toBe(true)
      expect(r.config.mcp?.server.port).toBe(5000)
      expect(r.config.mcp?.server.tool.name).toBe('ra')
      expect(r.config.mcp?.server.tool.description).toBe('My agent')
    })
  })
})
