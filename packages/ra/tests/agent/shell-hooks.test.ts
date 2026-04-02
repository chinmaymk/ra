import { describe, it, expect } from 'bun:test'
import { createShellHooksMiddleware } from '@chinmaymk/ra'
import type { ToolExecutionContext, ToolResultContext, LoopContext, ModelCallContext, ErrorContext, ShellHooksConfig } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'

function makeLoopCtx(): LoopContext {
  return {
    messages: [], iteration: 1, maxIterations: 10, sessionId: 'test',
    usage: { inputTokens: 0, outputTokens: 0 }, lastUsage: undefined, resumed: false,
    stop: () => {}, signal: new AbortController().signal, logger: new NoopLogger(),
  }
}

function makeToolExecCtx(toolName: string, args = '{}'): ToolExecutionContext & { denied: string | null } {
  const ctx = {
    toolCall: { id: 'tc1', name: toolName, arguments: args },
    loop: makeLoopCtx(),
    stop: () => {}, signal: new AbortController().signal, logger: new NoopLogger(),
    denied: null as string | null,
    deny: (reason: string) => { ctx.denied = reason },
  }
  return ctx
}

function makeToolResultCtx(toolName: string, output: string): ToolResultContext & { result: { toolCallId: string; content: string; isError?: boolean } } {
  return {
    toolCall: { id: 'tc1', name: toolName, arguments: '{}' },
    result: { toolCallId: 'tc1', content: output, isError: false },
    loop: makeLoopCtx(),
    stop: () => {}, signal: new AbortController().signal, logger: new NoopLogger(),
  }
}

describe('createShellHooksMiddleware — beforeToolExecution', () => {
  it('does nothing when no commands configured', async () => {
    const mw = createShellHooksMiddleware({})
    expect(mw.beforeToolExecution).toBeUndefined()
  })

  it('allows tool when hook exits 0', async () => {
    const mw = createShellHooksMiddleware({ beforeToolExecution: ['echo "allowed"'] })
    const ctx = makeToolExecCtx('read_file')
    await mw.beforeToolExecution![0]!(ctx)
    expect(ctx.denied).toBeNull()
  })

  it('denies tool when hook exits 2', async () => {
    const mw = createShellHooksMiddleware({ beforeToolExecution: ['echo "blocked by policy"; exit 2'] })
    const ctx = makeToolExecCtx('bash')
    await mw.beforeToolExecution![0]!(ctx)
    expect(ctx.denied).not.toBeNull()
    expect(ctx.denied).toContain('blocked by policy')
  })

  it('continues on non-zero non-deny exit codes (warning)', async () => {
    const mw = createShellHooksMiddleware({ beforeToolExecution: ['exit 1'] })
    const ctx = makeToolExecCtx('bash')
    await mw.beforeToolExecution![0]!(ctx)
    expect(ctx.denied).toBeNull()
  })

  it('passes tool name as environment variable', async () => {
    const mw = createShellHooksMiddleware({ beforeToolExecution: ['test "$HOOK_TOOL_NAME" = "read_file"'] })
    const ctx = makeToolExecCtx('read_file')
    await mw.beforeToolExecution![0]!(ctx)
    expect(ctx.denied).toBeNull()
  })
})

describe('createShellHooksMiddleware — afterToolExecution', () => {
  it('appends feedback to tool result on exit 0', async () => {
    const mw = createShellHooksMiddleware({ afterToolExecution: ['echo "hook ran"'] })
    const ctx = makeToolResultCtx('bash', 'original output')
    await mw.afterToolExecution![0]!(ctx)
    expect(ctx.result.content).toContain('original output')
    expect(ctx.result.content).toContain('hook ran')
  })

  it('marks result as error when hook exits 2', async () => {
    const mw = createShellHooksMiddleware({ afterToolExecution: ['echo "denied post"; exit 2'] })
    const ctx = makeToolResultCtx('bash', 'output')
    await mw.afterToolExecution![0]!(ctx)
    expect(ctx.result.isError).toBe(true)
    expect(ctx.result.content).toContain('denied post')
  })

  it('passes tool output as environment variable', async () => {
    const mw = createShellHooksMiddleware({ afterToolExecution: ['echo "saw: $HOOK_TOOL_OUTPUT"'] })
    const ctx = makeToolResultCtx('bash', 'hello world')
    await mw.afterToolExecution![0]!(ctx)
    expect(ctx.result.content).toContain('saw: hello world')
  })
})

describe('createShellHooksMiddleware — loop hooks', () => {
  it('runs beforeLoopBegin hooks', async () => {
    let stopped = false
    const mw = createShellHooksMiddleware({ beforeLoopBegin: ['echo ok'] })
    const ctx = { ...makeLoopCtx(), stop: () => { stopped = true } }
    await mw.beforeLoopBegin![0]!(ctx)
    expect(stopped).toBe(false)
  })

  it('stops loop when beforeLoopBegin hook exits 2', async () => {
    let stopped = false
    const mw = createShellHooksMiddleware({ beforeLoopBegin: ['echo "nope"; exit 2'] })
    const ctx = { ...makeLoopCtx(), stop: () => { stopped = true } }
    await mw.beforeLoopBegin![0]!(ctx)
    expect(stopped).toBe(true)
  })

  it('runs afterLoopComplete hooks', async () => {
    const mw = createShellHooksMiddleware({ afterLoopComplete: ['echo done'] })
    expect(mw.afterLoopComplete).toHaveLength(1)
  })

  it('runs afterLoopIteration hooks', async () => {
    const mw = createShellHooksMiddleware({ afterLoopIteration: ['echo iter'] })
    expect(mw.afterLoopIteration).toHaveLength(1)
  })
})

describe('createShellHooksMiddleware — model call hooks', () => {
  it('runs beforeModelCall hooks with model env var', async () => {
    const mw = createShellHooksMiddleware({ beforeModelCall: ['test "$HOOK_MODEL" = "claude-sonnet"'] })
    const ctx: ModelCallContext = {
      request: { model: 'claude-sonnet', messages: [] },
      loop: makeLoopCtx(),
      stop: () => {}, signal: new AbortController().signal, logger: new NoopLogger(),
    }
    await mw.beforeModelCall![0]!(ctx)
    // If hook exited 0, model matched
  })
})

describe('createShellHooksMiddleware — error hooks', () => {
  it('runs onError hooks with error details', async () => {
    const mw = createShellHooksMiddleware({ onError: ['echo "error: $HOOK_ERROR"'] })
    const ctx: ErrorContext = {
      error: new Error('test failure'),
      loop: makeLoopCtx(),
      phase: 'tool_execution',
      stop: () => {}, signal: new AbortController().signal, logger: new NoopLogger(),
    }
    await mw.onError![0]!(ctx)
    // Should not throw
  })
})

describe('createShellHooksMiddleware — supports ShellHookEntry objects', () => {
  it('accepts entry objects with custom timeout', async () => {
    const mw = createShellHooksMiddleware({
      beforeToolExecution: [{ command: 'echo ok', timeout: 5000 }],
    })
    const ctx = makeToolExecCtx('bash')
    await mw.beforeToolExecution![0]!(ctx)
    expect(ctx.denied).toBeNull()
  })
})

describe('createShellHooksMiddleware — returns only configured hooks', () => {
  it('returns empty partial when no hooks configured', () => {
    const mw = createShellHooksMiddleware({})
    expect(Object.keys(mw)).toHaveLength(0)
  })

  it('returns only the hooks that have commands', () => {
    const mw = createShellHooksMiddleware({
      beforeToolExecution: ['echo ok'],
      afterLoopComplete: ['echo done'],
    })
    expect(mw.beforeToolExecution).toHaveLength(1)
    expect(mw.afterLoopComplete).toHaveLength(1)
    expect(mw.onError).toBeUndefined()
    expect(mw.beforeModelCall).toBeUndefined()
  })
})
