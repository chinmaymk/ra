import { describe, it, expect } from 'bun:test'
import { parseArgs } from '../src/interfaces/parse-args'

// Simulate bun dev invocation: ['bun', 'src/index.ts', ...args]
function dev(...args: string[]): string[] {
  return ['bun', 'src/index.ts', ...args]
}

// Simulate compiled binary invocation: ['/usr/local/bin/ra', ...args]
function bin(...args: string[]): string[] {
  return ['/usr/local/bin/ra', ...args]
}

describe('parseArgs', () => {
  describe('offset detection', () => {
    it('skips 2 tokens when argv[1] is a .ts file (dev mode)', () => {
      const result = parseArgs(dev('hello'))
      expect(result.prompt).toBe('hello')
    })

    it('skips 1 token when argv[0] is a compiled binary', () => {
      const result = parseArgs(bin('hello'))
      expect(result.prompt).toBe('hello')
    })

    it('also handles .js and .mjs source extensions', () => {
      expect(parseArgs(['node', 'src/index.js', 'hi']).prompt).toBe('hi')
      expect(parseArgs(['node', 'src/index.mjs', 'hi']).prompt).toBe('hi')
    })
  })

  describe('flags with values', () => {
    it('parses --provider', () => {
      expect(parseArgs(dev('--provider', 'openai')).provider).toBe('openai')
    })

    it('parses --model', () => {
      expect(parseArgs(dev('--model', 'gpt-4o')).model).toBe('gpt-4o')
    })

    it('parses --config', () => {
      expect(parseArgs(dev('--config', '/etc/ra.yaml')).config).toBe('/etc/ra.yaml')
    })

    it('parses --system-prompt', () => {
      expect(parseArgs(dev('--system-prompt', 'Be helpful')).systemPrompt).toBe('Be helpful')
    })

    it('parses --resume', () => {
      expect(parseArgs(dev('--resume', 'sess-123')).resume).toBe('sess-123')
    })
  })

  describe('repeatable flags', () => {
    it('parses multiple --skill flags', () => {
      const r = parseArgs(dev('--skill', 'code', '--skill', 'search'))
      expect(r.skills).toEqual(['code', 'search'])
    })

    it('parses multiple --file flags', () => {
      const r = parseArgs(dev('--file', 'a.txt', '--file', 'b.pdf'))
      expect(r.files).toEqual(['a.txt', 'b.pdf'])
    })
  })

  describe('boolean flags', () => {
    it('parses --help', () => {
      expect(parseArgs(dev('--help')).help).toBe(true)
    })

    it('parses -h', () => {
      expect(parseArgs(dev('-h')).help).toBe(true)
    })

    it('defaults help to false', () => {
      expect(parseArgs(dev()).help).toBe(false)
    })

    it('parses --http', () => {
      expect(parseArgs(dev('--http')).http).toBe(true)
    })

    it('parses --repl', () => {
      expect(parseArgs(dev('--repl')).repl).toBe(true)
    })

    it('parses --mcp', () => {
      expect(parseArgs(dev('--mcp')).mcp).toBe(true)
    })

    it('parses --cli', () => {
      expect(parseArgs(dev('--cli', 'do this')).cli).toBe(true)
    })
  })

  describe('positional arguments', () => {
    it('captures a single positional as prompt', () => {
      expect(parseArgs(dev('hello')).prompt).toBe('hello')
    })

    it('joins multiple positionals with a space', () => {
      expect(parseArgs(dev('hello', 'world')).prompt).toBe('hello world')
    })

    it('prompt is undefined when no positionals', () => {
      expect(parseArgs(dev('--provider', 'openai')).prompt).toBeUndefined()
    })
  })

  describe('mixed usage', () => {
    it('combines flags and a prompt', () => {
      const r = parseArgs(dev('--provider', 'anthropic', '--model', 'claude-3', 'What is 1+1?'))
      expect(r.provider).toBe('anthropic')
      expect(r.model).toBe('claude-3')
      expect(r.prompt).toBe('What is 1+1?')
    })

    it('handles flags after the prompt', () => {
      const r = parseArgs(dev('my prompt', '--provider', 'openai'))
      expect(r.prompt).toBe('my prompt')
      expect(r.provider).toBe('openai')
    })
  })

  describe('edge cases', () => {
    it('handles flags and positionals mixed', () => {
      const r = parseArgs(dev('--model', 'gpt-4o', 'my prompt'))
      expect(r.model).toBe('gpt-4o')
      expect(r.prompt).toBe('my prompt')
    })

    it('handles empty argv', () => {
      const r = parseArgs(['ra'])
      expect(r.prompt).toBeUndefined()
      expect(r.help).toBe(false)
      expect(r.http).toBe(false)
    })
  })
})
