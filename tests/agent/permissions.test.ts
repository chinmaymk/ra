import { describe, it, expect } from 'bun:test'
import { createPermissionsMiddleware } from '../../src/agent/permissions'
import type { PermissionsConfig } from '../../src/config/types'
import type { ToolExecutionContext } from '../../src/agent/types'

function makeCtx(toolName: string, args: Record<string, unknown>): ToolExecutionContext & { denied?: string } {
  let denied: string | undefined
  const ac = new AbortController()
  return {
    toolCall: { id: 'tc1', name: toolName, arguments: JSON.stringify(args) },
    loop: { messages: [], iteration: 0, maxIterations: 10, sessionId: 'test', usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, stop: () => {}, signal: ac.signal },
    stop: () => {}, signal: ac.signal,
    deny: (r: string) => { denied = r },
    get denied() { return denied },
  }
}

describe('permissions middleware', () => {
  it('allows everything when no_rules_rules is true', async () => {
    const mw = createPermissionsMiddleware({ no_rules_rules: true, rules: [{ tool: 'execute_bash', command: { deny: ['.*'] } }] })
    const ctx = makeCtx('execute_bash', { command: 'rm -rf /' })
    await mw(ctx)
    expect(ctx.denied).toBeUndefined()
  })

  it('allows everything when rules are empty or missing', async () => {
    for (const config of [{ rules: [] }, {}] as PermissionsConfig[]) {
      const ctx = makeCtx('execute_bash', { command: 'anything' })
      await createPermissionsMiddleware(config)(ctx)
      expect(ctx.denied).toBeUndefined()
    }
  })

  it('blocks when deny regex matches', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }] })
    const ctx = makeCtx('execute_bash', { command: 'git push --force' })
    await mw(ctx)
    expect(ctx.denied).toContain('Permission denied')
    expect(ctx.denied).toContain('--force')
  })

  it('allows when deny regex does not match', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }] })
    const ctx = makeCtx('execute_bash', { command: 'git push' })
    await mw(ctx)
    expect(ctx.denied).toBeUndefined()
  })

  it('blocks with multiple deny patterns', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'execute_bash', command: { deny: ['--force', '--hard', '--no-verify'] } }] })

    const ctx1 = makeCtx('execute_bash', { command: 'git reset --hard' })
    await mw(ctx1)
    expect(ctx1.denied).toContain('--hard')

    const ctx2 = makeCtx('execute_bash', { command: 'git commit --no-verify' })
    await mw(ctx2)
    expect(ctx2.denied).toContain('--no-verify')
  })

  it('allows when allow regex matches', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'execute_bash', command: { allow: ['^git ', '^bun '] } }] })
    const ctx = makeCtx('execute_bash', { command: 'git status' })
    await mw(ctx)
    expect(ctx.denied).toBeUndefined()
  })

  it('blocks when no allow regex matches', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'execute_bash', command: { allow: ['^git ', '^bun '] } }] })
    const ctx = makeCtx('execute_bash', { command: 'rm -rf /' })
    await mw(ctx)
    expect(ctx.denied).toContain('did not match any allow rule')
  })

  it('deny takes priority over allow', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'execute_bash', command: { allow: ['^git push'], deny: ['--force', '-f'] } }] })

    const ctx1 = makeCtx('execute_bash', { command: 'git push --force' })
    await mw(ctx1)
    expect(ctx1.denied).toContain('--force')

    const ctx2 = makeCtx('execute_bash', { command: 'git push origin main' })
    await mw(ctx2)
    expect(ctx2.denied).toBeUndefined()
  })

  it('blocks write to .env file', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'write_file', path: { deny: ['\\.env'] } }] })
    const ctx = makeCtx('write_file', { path: '.env', content: 'SECRET=123' })
    await mw(ctx)
    expect(ctx.denied).toContain('Permission denied')
  })

  it('allows/blocks writes based on path allow list', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'write_file', path: { allow: ['^src/', '^tests/'] } }] })

    const ctx1 = makeCtx('write_file', { path: 'src/index.ts', content: 'hello' })
    await mw(ctx1)
    expect(ctx1.denied).toBeUndefined()

    const ctx2 = makeCtx('write_file', { path: '/etc/passwd', content: 'hacked' })
    await mw(ctx2)
    expect(ctx2.denied).toContain('did not match any allow rule')
  })

  it('constrains both path and content', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'write_file', path: { allow: ['^src/'] }, content: { deny: ['API_KEY', 'SECRET'] } }] })

    const ctx1 = makeCtx('write_file', { path: 'src/config.ts', content: 'const API_KEY = "sk-123"' })
    await mw(ctx1)
    expect(ctx1.denied).toContain('API_KEY')

    const ctx2 = makeCtx('write_file', { path: 'src/config.ts', content: 'const port = 3000' })
    await mw(ctx2)
    expect(ctx2.denied).toBeUndefined()
  })

  it('blocks localhost urls in web_fetch', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'web_fetch', url: { deny: ['localhost', '127\\.0\\.0\\.1'] } }] })
    const ctx = makeCtx('web_fetch', { url: 'http://localhost:8080/admin' })
    await mw(ctx)
    expect(ctx.denied).toContain('Permission denied')
  })

  it('respects default_action allow', async () => {
    const mw = createPermissionsMiddleware({ default_action: 'allow', rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }] })
    const ctx = makeCtx('write_file', { path: 'anything', content: 'anything' })
    await mw(ctx)
    expect(ctx.denied).toBeUndefined()
  })

  it('respects default_action deny', async () => {
    const mw = createPermissionsMiddleware({ default_action: 'deny', rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }] })
    const ctx = makeCtx('write_file', { path: 'anything', content: 'anything' })
    await mw(ctx)
    expect(ctx.denied).toContain("no rules configured for tool 'write_file'")
  })

  it('evaluates multiple rules for same tool in order', async () => {
    const mw = createPermissionsMiddleware({ rules: [
      { tool: 'execute_bash', command: { allow: ['^git '] } },
      { tool: 'execute_bash', command: { deny: ['--force'] } },
    ] })
    const ctx = makeCtx('execute_bash', { command: 'git push --force' })
    await mw(ctx)
    expect(ctx.denied).toContain('--force')
  })

  it('blocks all deletes with deny all', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'delete_file', path: { deny: ['.*'] } }] })
    const ctx = makeCtx('delete_file', { path: 'anything.ts' })
    await mw(ctx)
    expect(ctx.denied).toContain('Permission denied')
  })

  it('checks both source and destination fields for move_file', async () => {
    const mw = createPermissionsMiddleware({ rules: [{ tool: 'move_file', source: { deny: ['node_modules/'] }, destination: { allow: ['^src/'] } }] })

    const ctx1 = makeCtx('move_file', { source: 'node_modules/pkg/index.js', destination: 'src/vendor.js' })
    await mw(ctx1)
    expect(ctx1.denied).toContain('node_modules')

    const ctx2 = makeCtx('move_file', { source: 'tmp/file.ts', destination: 'dist/file.ts' })
    await mw(ctx2)
    expect(ctx2.denied).toContain('did not match any allow rule')

    const ctx3 = makeCtx('move_file', { source: 'tmp/file.ts', destination: 'src/file.ts' })
    await mw(ctx3)
    expect(ctx3.denied).toBeUndefined()
  })

  it('denied tool call becomes error result in loop', async () => {
    const { AgentLoop } = await import('../../src/agent/loop')
    const { ToolRegistry } = await import('../../src/agent/tool-registry')

    let toolExecuted = false
    const tools = new ToolRegistry()
    tools.register({ name: 'execute_bash', description: 'bash', inputSchema: {}, execute: async () => { toolExecuted = true; return 'executed' } })

    const permMw = createPermissionsMiddleware({ rules: [{ tool: 'execute_bash', command: { deny: ['--force'] } }] })

    let callCount = 0
    const provider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        if (++callCount === 1) {
          yield { type: 'tool_call_start' as const, id: 'tc1', name: 'execute_bash' }
          yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{"command":"git push --force"}' }
          yield { type: 'tool_call_end' as const, id: 'tc1' }
          yield { type: 'done' as const }
        } else {
          yield { type: 'text' as const, delta: 'ok' }
          yield { type: 'done' as const }
        }
      },
    }

    const loop = new AgentLoop({ provider, tools, maxIterations: 5, middleware: { beforeToolExecution: [permMw] } })
    const result = await loop.run([{ role: 'user', content: 'push' }])

    expect(toolExecuted).toBe(false)
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.isError).toBe(true)
    expect(toolResult?.content).toContain('Permission denied')
  })
})
