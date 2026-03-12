import { describe, it, expect } from 'bun:test'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { IProvider, ChatRequest } from '../../src/providers/types'

/** Helper that waits but resolves early if the signal fires */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

function slowProvider(delayMs: number): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream(req: ChatRequest) {
      yield { type: 'text', delta: 'start ' }
      await abortableDelay(delayMs, req.signal)
      if (req.signal?.aborted) return
      yield { type: 'text', delta: 'end' }
      yield { type: 'done' }
    },
  }
}

describe('AgentLoop.abort()', () => {
  it('stops a running loop and returns partial results with stopReason', async () => {
    const loop = new AgentLoop({
      provider: slowProvider(5000),
      tools: new ToolRegistry(),
      model: 'test',
      maxIterations: 5,
    })

    const resultPromise = loop.run([{ role: 'user', content: 'hi' }])

    await new Promise(resolve => setTimeout(resolve, 50))
    loop.abort()

    const result = await resultPromise
    expect(result.stopReason).toBe('aborted')
    expect(result.messages.length).toBeGreaterThanOrEqual(1)
  })

  it('prevents further iterations after abort during tool execution', async () => {
    let streamCalls = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        streamCalls++
        // Always emit a tool call so the loop would normally continue
        yield { type: 'tool_call_start' as const, id: `tc${streamCalls}`, name: 'fast' }
        yield { type: 'tool_call_delta' as const, id: `tc${streamCalls}`, argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: `tc${streamCalls}` }
        yield { type: 'done' as const }
      },
    }

    const tools = new ToolRegistry()
    let toolExecutions = 0
    tools.register({
      name: 'fast',
      description: 'fast tool',
      inputSchema: {},
      execute: async () => { toolExecutions++; await new Promise(r => setTimeout(r, 100)); return 'ok' },
    })

    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 10 })
    const resultPromise = loop.run([{ role: 'user', content: 'go' }])

    // Wait for stream to complete and tool execution to start, then abort
    await new Promise(resolve => setTimeout(resolve, 20))
    loop.abort()

    const result = await resultPromise
    // Should have stopped — only 1 stream call, 1 tool execution
    expect(streamCalls).toBe(1)
    expect(toolExecutions).toBe(1)
    expect(result.stopReason).toBe('aborted')
  })

  it('is a no-op when no loop is running', () => {
    const loop = new AgentLoop({
      provider: slowProvider(100),
      tools: new ToolRegistry(),
      model: 'test',
    })
    loop.abort()
  })

  it('passes signal through to ChatRequest', async () => {
    let capturedSignal: AbortSignal | undefined
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        capturedSignal = req.signal
        yield { type: 'text', delta: 'hi' }
        yield { type: 'done' }
      },
    }

    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), model: 'test' })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(false)
  })

  it('signal is aborted when abort() is called', async () => {
    let capturedSignal: AbortSignal | undefined
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        capturedSignal = req.signal
        yield { type: 'text', delta: 'start' }
        await abortableDelay(5000, req.signal)
        if (req.signal?.aborted) return
        yield { type: 'text', delta: 'end' }
        yield { type: 'done' }
      },
    }

    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), model: 'test' })
    const resultPromise = loop.run([{ role: 'user', content: 'hi' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    loop.abort()
    await resultPromise

    expect(capturedSignal).toBeDefined()
    expect(capturedSignal!.aborted).toBe(true)
  })

  it('loop can be reused after abort', async () => {
    let callIndex = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        callIndex++
        if (callIndex === 1) {
          yield { type: 'text', delta: 'slow' }
          await abortableDelay(5000, req.signal)
          if (req.signal?.aborted) return
        }
        yield { type: 'text', delta: 'fast' }
        yield { type: 'done' }
      },
    }

    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), model: 'test' })

    // First run: abort
    const p1 = loop.run([{ role: 'user', content: 'first' }])
    await new Promise(resolve => setTimeout(resolve, 50))
    loop.abort()
    const r1 = await p1
    expect(r1.stopReason).toBe('aborted')

    // Second run: should complete normally
    const r2 = await loop.run([{ role: 'user', content: 'second' }])
    expect(r2.stopReason).toBeUndefined()
    expect(r2.messages.at(-1)?.content).toBe('fast')
  })
})
