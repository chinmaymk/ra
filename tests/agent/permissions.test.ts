import { describe, it, expect } from 'bun:test'
import { createPermissionsMiddleware } from '../../src/agent/permissions'
import type { PermissionsConfig } from '../../src/config/types'
import type { ToolExecutionContext } from '../../src/agent/types'

function makeCtx(toolName: string, args: Record<string, unknown>): ToolExecutionContext {
  let denied: string | undefined
  return {
    toolCall: { id: 'tc1', name: toolName, arguments: JSON.stringify(args) },
    loop: {
      messages: [],
      iteration: 0,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      stop: () => {},
      signal: new AbortController().signal,
    },
    stop: () => {},
    signal: new AbortController().signal,
    deny: (reason: string) => { denied = reason },
    get denied() { return denied },
  }
}

describe('permissions middleware', () => {
  describe('no_rules', () => {
    it('allows everything when no_rules is true', async () => {
      const mw = createPermissionsMiddleware({ no_rules: true, rules: [{ tool: 'execute_bash', command: { deny: ['.*'] } }] })
      const ctx = makeCtx('execute_bash', { command: 'rm -rf /' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })
  })

  describe('no rules configured', () => {
    it('allows everything when rules array is empty', async () => {
      const mw = createPermissionsMiddleware({ rules: [] })
      const ctx = makeCtx('execute_bash', { command: 'anything' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })

    it('allows everything when no config provided', async () => {
      const mw = createPermissionsMiddleware({})
      const ctx = makeCtx('execute_bash', { command: 'anything' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })
  })

  describe('deny rules', () => {
    it('blocks when deny regex matches', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'execute_bash',
          command: { deny: ['--force'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('execute_bash', { command: 'git push --force' })
      await mw(ctx)
      expect(ctx.denied).toContain('Permission denied')
      expect(ctx.denied).toContain('--force')
    })

    it('allows when deny regex does not match', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'execute_bash',
          command: { deny: ['--force'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('execute_bash', { command: 'git push' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })

    it('blocks with multiple deny patterns', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'execute_bash',
          command: { deny: ['--force', '--hard', '--no-verify'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)

      const ctx1 = makeCtx('execute_bash', { command: 'git reset --hard' })
      await mw(ctx1)
      expect(ctx1.denied).toContain('--hard')

      const ctx2 = makeCtx('execute_bash', { command: 'git commit --no-verify' })
      await mw(ctx2)
      expect(ctx2.denied).toContain('--no-verify')
    })
  })

  describe('allow rules', () => {
    it('allows when allow regex matches', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'execute_bash',
          command: { allow: ['^git ', '^bun '] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('execute_bash', { command: 'git status' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })

    it('blocks when no allow regex matches', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'execute_bash',
          command: { allow: ['^git ', '^bun '] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('execute_bash', { command: 'rm -rf /' })
      await mw(ctx)
      expect(ctx.denied).toContain('did not match any allow rule')
    })
  })

  describe('deny takes priority over allow', () => {
    it('deny wins even when allow matches', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'execute_bash',
          command: {
            allow: ['^git push'],
            deny: ['--force', '-f'],
          },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('execute_bash', { command: 'git push --force' })
      await mw(ctx)
      expect(ctx.denied).toContain('--force')
    })

    it('allows when deny does not match but allow does', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'execute_bash',
          command: {
            allow: ['^git push'],
            deny: ['--force', '-f'],
          },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('execute_bash', { command: 'git push origin main' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })
  })

  describe('file tool rules', () => {
    it('blocks write to .env file', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'write_file',
          path: { deny: ['\\.env'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('write_file', { path: '.env', content: 'SECRET=123' })
      await mw(ctx)
      expect(ctx.denied).toContain('Permission denied')
      expect(ctx.denied).toContain('.env')
    })

    it('allows write to src/ when path is allowed', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'write_file',
          path: { allow: ['^src/', '^tests/'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('write_file', { path: 'src/index.ts', content: 'hello' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })

    it('blocks write outside allowed paths', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'write_file',
          path: { allow: ['^src/', '^tests/'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('write_file', { path: '/etc/passwd', content: 'hacked' })
      await mw(ctx)
      expect(ctx.denied).toContain('did not match any allow rule')
    })

    it('can constrain both path and content', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'write_file',
          path: { allow: ['^src/'] },
          content: { deny: ['API_KEY', 'SECRET'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)

      // Path ok but content has secret
      const ctx1 = makeCtx('write_file', { path: 'src/config.ts', content: 'const API_KEY = "sk-123"' })
      await mw(ctx1)
      expect(ctx1.denied).toContain('API_KEY')

      // Both ok
      const ctx2 = makeCtx('write_file', { path: 'src/config.ts', content: 'const port = 3000' })
      await mw(ctx2)
      expect(ctx2.denied).toBeUndefined()
    })
  })

  describe('web_fetch rules', () => {
    it('blocks localhost urls', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'web_fetch',
          url: { deny: ['localhost', '127\\.0\\.0\\.1', '169\\.254\\.'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('web_fetch', { url: 'http://localhost:8080/admin' })
      await mw(ctx)
      expect(ctx.denied).toContain('Permission denied')
    })
  })

  describe('default_action', () => {
    it('allows tools with no rules when default is allow', async () => {
      const config: PermissionsConfig = {
        default_action: 'allow',
        rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('write_file', { path: 'anything', content: 'anything' })
      await mw(ctx)
      expect(ctx.denied).toBeUndefined()
    })

    it('blocks tools with no rules when default is deny', async () => {
      const config: PermissionsConfig = {
        default_action: 'deny',
        rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('write_file', { path: 'anything', content: 'anything' })
      await mw(ctx)
      expect(ctx.denied).toContain("no rules configured for tool 'write_file'")
    })
  })

  describe('multiple rules for same tool', () => {
    it('evaluates all rules in order', async () => {
      const config: PermissionsConfig = {
        rules: [
          { tool: 'execute_bash', command: { allow: ['^git '] } },
          { tool: 'execute_bash', command: { deny: ['--force'] } },
        ],
      }
      const mw = createPermissionsMiddleware(config)

      // Matches first allow, but denied by second rule
      const ctx = makeCtx('execute_bash', { command: 'git push --force' })
      await mw(ctx)
      expect(ctx.denied).toContain('--force')
    })
  })

  describe('delete_file rules', () => {
    it('blocks all deletes with deny all', async () => {
      const config: PermissionsConfig = {
        rules: [{ tool: 'delete_file', path: { deny: ['.*'] } }],
      }
      const mw = createPermissionsMiddleware(config)
      const ctx = makeCtx('delete_file', { path: 'anything.ts' })
      await mw(ctx)
      expect(ctx.denied).toContain('Permission denied')
    })
  })

  describe('move_file rules', () => {
    it('checks both source and destination fields', async () => {
      const config: PermissionsConfig = {
        rules: [{
          tool: 'move_file',
          source: { deny: ['node_modules/'] },
          destination: { allow: ['^src/'] },
        }],
      }
      const mw = createPermissionsMiddleware(config)

      // Source matches deny
      const ctx1 = makeCtx('move_file', { source: 'node_modules/pkg/index.js', destination: 'src/vendor.js' })
      await mw(ctx1)
      expect(ctx1.denied).toContain('node_modules')

      // Destination doesn't match allow
      const ctx2 = makeCtx('move_file', { source: 'tmp/file.ts', destination: 'dist/file.ts' })
      await mw(ctx2)
      expect(ctx2.denied).toContain('did not match any allow rule')

      // Both ok
      const ctx3 = makeCtx('move_file', { source: 'tmp/file.ts', destination: 'src/file.ts' })
      await mw(ctx3)
      expect(ctx3.denied).toBeUndefined()
    })
  })

  describe('loop integration - deny skips execution', () => {
    it('denied tool call becomes error result in loop', async () => {
      // This tests the loop.ts integration via the AgentLoop
      const { AgentLoop } = await import('../../src/agent/loop')
      const { ToolRegistry } = await import('../../src/agent/tool-registry')
      const { createPermissionsMiddleware } = await import('../../src/agent/permissions')

      let toolExecuted = false
      const tools = new ToolRegistry()
      tools.register({
        name: 'execute_bash',
        description: 'bash',
        inputSchema: {},
        execute: async () => { toolExecuted = true; return 'executed' },
      })

      const permMw = createPermissionsMiddleware({
        rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }],
      })

      const provider = {
        name: 'mock',
        chat: async () => { throw new Error('use stream') },
        async *stream() {
          yield { type: 'tool_call_start' as const, id: 'tc1', name: 'execute_bash' }
          yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{"command":"git push --force"}' }
          yield { type: 'tool_call_end' as const, id: 'tc1' }
          yield { type: 'done' as const }
        },
      }

      // Provider returns text on second call (after denied tool)
      let callCount = 0
      const mockProvider = {
        ...provider,
        async *stream() {
          callCount++
          if (callCount === 1) {
            yield { type: 'tool_call_start' as const, id: 'tc1', name: 'execute_bash' }
            yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{"command":"git push --force"}' }
            yield { type: 'tool_call_end' as const, id: 'tc1' }
            yield { type: 'done' as const }
          } else {
            yield { type: 'text' as const, delta: 'ok I will not force push' }
            yield { type: 'done' as const }
          }
        },
      }

      const loop = new AgentLoop({
        provider: mockProvider,
        tools,
        maxIterations: 5,
        middleware: { beforeToolExecution: [permMw] },
      })

      const result = await loop.run([{ role: 'user', content: 'push' }])

      // Tool should NOT have been executed
      expect(toolExecuted).toBe(false)

      // The denied tool result should be in messages
      const toolResult = result.messages.find(m => m.role === 'tool')
      expect(toolResult).toBeDefined()
      expect(toolResult!.isError).toBe(true)
      expect(toolResult!.content).toContain('Permission denied')
    })
  })
})
