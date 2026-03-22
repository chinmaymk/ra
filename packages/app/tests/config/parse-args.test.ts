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

  describe('interface flags → config.app.interface', () => {
    it('--http sets http', () => expect(parseArgs(dev('--http')).config.app?.interface).toBe('http'))
    it('--repl sets repl', () => expect(parseArgs(dev('--repl')).config.app?.interface).toBe('repl'))
    it('--repl with positional prompt preserves repl interface', () => {
      const result = parseArgs(['bun', 'src/index.ts', '--repl', 'hello world'])
      expect(result.config.app?.interface).toBe('repl')
      expect(result.meta.prompt).toBe('hello world')
    })
    it('--cron sets cron', () => expect(parseArgs(dev('--cron')).config.app?.interface).toBe('cron'))
    it('--run-immediately sets runImmediately', () => expect(parseArgs(dev('--cron', '--run-immediately')).meta.runImmediately).toBe(true))
    it('runImmediately defaults to false', () => expect(parseArgs(dev('--cron')).meta.runImmediately).toBe(false))
    it('--cli sets cli',   () => expect(parseArgs(dev('--cli', 'x')).config.app?.interface).toBe('cli'))
    it('--mcp sets mcp',   () => expect(parseArgs(dev('--mcp')).config.app?.interface).toBe('mcp'))
    it('mcp takes precedence over http when both given', () => {
      expect(parseArgs(dev('--mcp', '--http')).config.app?.interface).toBe('mcp')
    })
    it('no flag leaves interface undefined', () => {
      expect(parseArgs(dev('--model', 'x')).config.app?.interface).toBeUndefined()
    })
  })

  describe('top-level config flags', () => {
    it('--provider', () => expect(parseArgs(dev('--provider', 'openai')).config.agent?.provider).toBe('openai'))
    it('--model',    () => expect(parseArgs(dev('--model', 'gpt-4o')).config.agent?.model).toBe('gpt-4o'))
    it('--system-prompt', () => expect(parseArgs(dev('--system-prompt', 'Be helpful')).config.agent?.systemPrompt).toBe('Be helpful'))
    it('--max-iterations', () => expect(parseArgs(dev('--max-iterations', '20')).config.agent?.maxIterations).toBe(20))
    it('--tool-timeout', () => expect(parseArgs(dev('--tool-timeout', '15000')).config.agent?.toolTimeout).toBe(15000))
    it('parses --tools-builtin flag', () => {
      const result = parseArgs(['node', 'ra.ts', '--tools-builtin'])
      expect(result.config.agent?.tools?.builtin).toBe(true)
    })
    it('parses --thinking flag', () => {
      const result = parseArgs(['node', 'ra.ts', '--thinking', 'high'])
      expect(result.config.agent?.thinking).toBe('high')
    })
  })

  describe('HTTP server flags', () => {
    it('--http-port sets config.app.http.port', () => {
      expect(parseArgs(dev('--http-port', '4000')).config.app?.http?.port).toBe(4000)
    })
    it('--http-token sets config.app.http.token', () => {
      expect(parseArgs(dev('--http-token', 'secret')).config.app?.http?.token).toBe('secret')
    })
    it('--http-port does not set token', () => {
      expect(parseArgs(dev('--http-port', '4000')).config.app?.http?.token).toBeUndefined()
    })
    it('--http-token does not set port', () => {
      expect(parseArgs(dev('--http-token', 'secret')).config.app?.http?.port).toBeUndefined()
    })
  })

  describe('MCP server flags', () => {
    it('--mcp-server-enabled', () => {
      expect(parseArgs(dev('--mcp-server-enabled')).config.app?.raMcpServer?.enabled).toBe(true)
    })
    it('--mcp-server-port', () => {
      expect(parseArgs(dev('--mcp-server-port', '4001')).config.app?.raMcpServer?.port).toBe(4001)
    })
    it('--mcp-stdio sets mcp-stdio', () => {
      expect(parseArgs(dev('--mcp-stdio')).config.app?.interface).toBe('mcp-stdio')
    })
    it('--mcp-server-tool-name', () => {
      expect(parseArgs(dev('--mcp-server-tool-name', 'mybot')).config.app?.raMcpServer?.tool.name).toBe('mybot')
    })
    it('--mcp-server-tool-description', () => {
      expect(parseArgs(dev('--mcp-server-tool-description', 'A bot')).config.app?.raMcpServer?.tool.description).toBe('A bot')
    })
    it('individual MCP flags do not clobber siblings', () => {
      const r = parseArgs(dev('--mcp-server-port', '5000'))
      expect(r.config.app?.raMcpServer?.port).toBe(5000)
      expect(r.config.app?.raMcpServer?.enabled).toBeUndefined()
    })
  })

  describe('data-dir and storage flags', () => {
    it('--data-dir', () => {
      expect(parseArgs(dev('--data-dir', '/tmp/data')).config.app?.dataDir).toBe('/tmp/data')
    })
    it('--storage-max-sessions', () => {
      expect(parseArgs(dev('--storage-max-sessions', '50')).config.app?.storage?.maxSessions).toBe(50)
    })
    it('--storage-ttl-days', () => {
      expect(parseArgs(dev('--storage-ttl-days', '7')).config.app?.storage?.ttlDays).toBe(7)
    })
    it('individual storage flags do not clobber siblings', () => {
      const r = parseArgs(dev('--storage-max-sessions', '50'))
      expect(r.config.app?.storage?.maxSessions).toBe(50)
      expect(r.config.app?.storage?.ttlDays).toBeUndefined()
    })
  })

  describe('provider connection flags', () => {
    it('--anthropic-base-url', () => {
      expect(parseArgs(dev('--anthropic-base-url', 'https://proxy/')).config.app?.providers?.anthropic.baseURL).toBe('https://proxy/')
    })
    it('--openai-base-url', () => {
      expect(parseArgs(dev('--openai-base-url', 'https://proxy/')).config.app?.providers?.openai.baseURL).toBe('https://proxy/')
    })
    it('--ollama-host', () => {
      expect(parseArgs(dev('--ollama-host', 'http://localhost:11434')).config.app?.providers?.ollama.host).toBe('http://localhost:11434')
    })
  })

  describe('skills flags', () => {
    it('--skill-dir sets config.agent.skillDirs', () => {
      expect(parseArgs(dev('--skill-dir', '/skills/a')).config.agent?.skillDirs).toEqual(['/skills/a'])
    })
    it('--skill-dir is repeatable', () => {
      expect(parseArgs(dev('--skill-dir', '/a', '--skill-dir', '/b')).config.agent?.skillDirs).toEqual(['/a', '/b'])
    })
  })

  describe('meta fields', () => {
    it('--config → meta.configPath', () => {
      expect(parseArgs(dev('--config', '/etc/ra.yaml')).meta.configPath).toBe('/etc/ra.yaml')
    })
    it('--resume without id → meta.resume is true', () => {
      expect(parseArgs(dev('--resume')).meta.resume).toBe(true)
    })
    it('--resume=<id> → meta.resume is the id', () => {
      expect(parseArgs(dev('--resume=sess-123')).meta.resume).toBe('sess-123')
    })
    it('--resume defaults to undefined', () => {
      expect(parseArgs(dev()).meta.resume).toBeUndefined()
    })
    it('--resume does not consume the next positional as session id', () => {
      const result = parseArgs(dev('--cli', '--resume', 'my prompt'))
      expect(result.meta.resume).toBe(true)
      expect(result.meta.prompt).toBe('my prompt')
    })
    it('--resume=<id> preserves the prompt', () => {
      const result = parseArgs(dev('--cli', '--resume=sess-456', 'my prompt'))
      expect(result.meta.resume).toBe('sess-456')
      expect(result.meta.prompt).toBe('my prompt')
    })
    it('--resume works from compiled binary', () => {
      expect(parseArgs(bin('--resume')).meta.resume).toBe(true)
      expect(parseArgs(bin('--resume=abc')).meta.resume).toBe('abc')
    })
    it('--help → meta.help', () => expect(parseArgs(dev('--help')).meta.help).toBe(true))
    it('-h → meta.help',     () => expect(parseArgs(dev('-h')).meta.help).toBe(true))
    it('defaults meta.help to false', () => expect(parseArgs(dev()).meta.help).toBe(false))
    it('parses --show-context flag', () => {
      const result = parseArgs(['bun', 'src/index.ts', '--show-context'])
      expect(result.meta.showContext).toBe(true)
    })
    it('parses --show-config flag', () => {
      const result = parseArgs(['bun', 'src/index.ts', '--show-config'])
      expect(result.meta.showConfig).toBe(true)
    })
    it('defaults showConfig to false', () => {
      expect(parseArgs(dev()).meta.showConfig).toBe(false)
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
      expect((r.config as any).app?.providers?.azure?.endpoint).toBe('https://myresource.openai.azure.com/')
    })

    it('--azure-deployment sets providers.azure.deployment', () => {
      const r = parseArgs(dev('--azure-deployment', 'my-gpt4o'))
      expect((r.config as any).app?.providers?.azure?.deployment).toBe('my-gpt4o')
    })
  })

  describe('subcommands (skill & recipe)', () => {
    for (const kind of ['skill', 'recipe'] as const) {
      it(`parses "${kind} install <source>"`, () => {
        const r = parseArgs(dev(kind, 'install', 'test-source'))
        expect(r.meta.subCommand).toEqual({ kind, action: 'install', args: ['test-source'] })
      })

      it(`parses "${kind} install" with multiple sources`, () => {
        const r = parseArgs(dev(kind, 'install', 'a', 'b'))
        expect(r.meta.subCommand).toEqual({ kind, action: 'install', args: ['a', 'b'] })
      })

      it(`parses "${kind} remove <name>"`, () => {
        const r = parseArgs(dev(kind, 'remove', 'test'))
        expect(r.meta.subCommand).toEqual({ kind, action: 'remove', args: ['test'] })
      })

      it(`parses "${kind} list"`, () => {
        const r = parseArgs(dev(kind, 'list'))
        expect(r.meta.subCommand).toEqual({ kind, action: 'list', args: [] })
      })

      it(`does not treat "${kind}" without subcommand as subcommand`, () => {
        const r = parseArgs(dev(kind))
        expect(r.meta.subCommand).toBeUndefined()
        expect(r.meta.prompt).toBe(kind)
      })
    }
  })

  describe('--recipe flag', () => {
    it('parses --recipe into meta.recipeName', () => {
      const r = parseArgs(dev('--recipe', 'user/repo'))
      expect(r.meta.recipeName).toBe('user/repo')
    })

    it('--recipe with prompt', () => {
      const r = parseArgs(dev('--recipe', 'user/repo', 'hello'))
      expect(r.meta.recipeName).toBe('user/repo')
      expect(r.meta.prompt).toBe('hello')
    })

    it('--recipe defaults to undefined', () => {
      expect(parseArgs(dev()).meta.recipeName).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('empty argv', () => {
      const r = parseArgs(['ra'])
      expect(r.meta.prompt).toBeUndefined()
      expect(r.meta.help).toBe(false)
      expect(r.config.app?.interface).toBeUndefined()
    })

    it('flags after prompt', () => {
      const r = parseArgs(dev('my prompt', '--provider', 'openai'))
      expect(r.meta.prompt).toBe('my prompt')
      expect(r.config.agent?.provider).toBe('openai')
    })

    it('ignores non-numeric --max-iterations', () => {
      const r = parseArgs(dev('--max-iterations', 'abc'))
      expect(r.config.agent?.maxIterations).toBeUndefined()
    })

    it('ignores non-numeric --http-port', () => {
      const r = parseArgs(dev('--http-port', 'not-a-number'))
      expect(r.config.app?.http?.port).toBeUndefined()
    })

    it('ignores non-numeric --storage-max-sessions', () => {
      const r = parseArgs(dev('--storage-max-sessions', 'xyz'))
      expect(r.config.app?.storage?.maxSessions).toBeUndefined()
    })

    it('all MCP server fields together', () => {
      const r = parseArgs(dev(
        '--mcp-server-enabled',
        '--mcp-server-port', '5000',
        '--mcp-server-tool-name', 'ra',
        '--mcp-server-tool-description', 'My agent',
      ))
      expect(r.config.app?.raMcpServer?.enabled).toBe(true)
      expect(r.config.app?.raMcpServer?.port).toBe(5000)
      expect(r.config.app?.raMcpServer?.tool.name).toBe('ra')
      expect(r.config.app?.raMcpServer?.tool.description).toBe('My agent')
    })
  })
})
