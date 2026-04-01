import { describe, it, expect } from 'bun:test'
import { createPreToolHookMiddleware, createPostToolHookMiddleware, createShellHooksMiddleware } from '@chinmaymk/ra'
import type { ToolExecutionContext, ToolResultContext, ShellHooksConfig } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'

function makeToolExecCtx(toolName: string, args = '{}'): ToolExecutionContext & { denied: string | null } {
  const ctx = {
    toolCall: { id: 'tc1', name: toolName, arguments: args },
    loop: {
      messages: [],
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      resumed: false,
      stop: () => {},
      signal: new AbortController().signal,
      logger: new NoopLogger(),
    },
    stop: () => {},
    signal: new AbortController().signal,
    logger: new NoopLogger(),
    denied: null as string | null,
    deny: (reason: string) => { ctx.denied = reason },
  }
  return ctx
}

function makeToolResultCtx(toolName: string, output: string): ToolResultContext & { result: { toolCallId: string; content: string; isError?: boolean } } {
  return {
    toolCall: { id: 'tc1', name: toolName, arguments: '{}' },
    result: { toolCallId: 'tc1', content: output, isError: false },
    loop: {
      messages: [],
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      resumed: false,
      stop: () => {},
      signal: new AbortController().signal,
      logger: new NoopLogger(),
    },
    stop: () => {},
    signal: new AbortController().signal,
    logger: new NoopLogger(),
  }
}

describe('createPreToolHookMiddleware', () => {
  it('does nothing when no commands configured', async () => {
    const middleware = createPreToolHookMiddleware({ preToolUse: [] })
    const ctx = makeToolExecCtx('bash')
    await middleware(ctx)
    expect(ctx.denied).toBeNull()
  })

  it('allows tool when hook exits 0', async () => {
    const middleware = createPreToolHookMiddleware({
      preToolUse: ['echo "allowed"'],
      timeout: 5000,
    })
    const ctx = makeToolExecCtx('read_file')
    await middleware(ctx)
    expect(ctx.denied).toBeNull()
  })

  it('denies tool when hook exits 2', async () => {
    const middleware = createPreToolHookMiddleware({
      preToolUse: ['echo "blocked by policy"; exit 2'],
      timeout: 5000,
    })
    const ctx = makeToolExecCtx('bash')
    await middleware(ctx)
    expect(ctx.denied).not.toBeNull()
    expect(ctx.denied).toContain('blocked by policy')
  })

  it('passes tool name as environment variable', async () => {
    const middleware = createPreToolHookMiddleware({
      preToolUse: ['echo "$HOOK_TOOL_NAME"'],
      timeout: 5000,
    })
    const ctx = makeToolExecCtx('read_file')
    await middleware(ctx)
    // Should succeed (exit 0) and tool name should be available
    expect(ctx.denied).toBeNull()
  })

  it('continues on non-zero non-deny exit codes (warning)', async () => {
    const middleware = createPreToolHookMiddleware({
      preToolUse: ['exit 1'],
      timeout: 5000,
    })
    const ctx = makeToolExecCtx('bash')
    await middleware(ctx)
    // Exit 1 = warn, not deny
    expect(ctx.denied).toBeNull()
  })
})

describe('createPostToolHookMiddleware', () => {
  it('does nothing when no commands configured', async () => {
    const middleware = createPostToolHookMiddleware({ postToolUse: [] })
    const ctx = makeToolResultCtx('bash', 'output')
    await middleware(ctx)
    expect(ctx.result.content).toBe('output')
  })

  it('appends feedback to tool result on exit 0', async () => {
    const middleware = createPostToolHookMiddleware({
      postToolUse: ['echo "hook ran"'],
      timeout: 5000,
    })
    const ctx = makeToolResultCtx('bash', 'original output')
    await middleware(ctx)
    expect(ctx.result.content).toContain('original output')
    expect(ctx.result.content).toContain('hook ran')
  })

  it('marks result as error when hook exits 2', async () => {
    const middleware = createPostToolHookMiddleware({
      postToolUse: ['echo "denied post"; exit 2'],
      timeout: 5000,
    })
    const ctx = makeToolResultCtx('bash', 'output')
    await middleware(ctx)
    expect(ctx.result.isError).toBe(true)
    expect(ctx.result.content).toContain('denied post')
  })

  it('passes tool output as environment variable', async () => {
    const middleware = createPostToolHookMiddleware({
      postToolUse: ['echo "saw: $HOOK_TOOL_OUTPUT"'],
      timeout: 5000,
    })
    const ctx = makeToolResultCtx('bash', 'hello world')
    await middleware(ctx)
    expect(ctx.result.content).toContain('saw: hello world')
  })
})

describe('createShellHooksMiddleware', () => {
  it('returns empty arrays when no hooks configured', () => {
    const { beforeToolExecution, afterToolExecution } = createShellHooksMiddleware({})
    expect(beforeToolExecution).toHaveLength(0)
    expect(afterToolExecution).toHaveLength(0)
  })

  it('returns middleware arrays when hooks are configured', () => {
    const { beforeToolExecution, afterToolExecution } = createShellHooksMiddleware({
      preToolUse: ['echo ok'],
      postToolUse: ['echo done'],
    })
    expect(beforeToolExecution).toHaveLength(1)
    expect(afterToolExecution).toHaveLength(1)
  })
})
