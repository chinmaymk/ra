import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { IProvider, StreamChunk } from '@chinmaymk/ra'
import { mockProvider } from './test-utils'

/** Provider that always emits a tool call to the given tool, then a final text response. */
function toolCallProvider(toolName: string, args = '{}', iterations = 1): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      callIndex++
      if (callIndex <= iterations) {
        yield { type: 'tool_call_start' as const, id: `tc${callIndex}`, name: toolName }
        yield { type: 'tool_call_delta' as const, id: `tc${callIndex}`, argsDelta: args }
        yield { type: 'tool_call_end' as const, id: `tc${callIndex}` }
        yield { type: 'done' as const }
      } else {
        yield { type: 'text' as const, delta: 'done' }
        yield { type: 'done' as const }
      }
    },
  }
}

/** Provider that emits multiple tool calls per iteration. */
function multiToolProvider(toolNames: string[], iterations = 1): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      callIndex++
      if (callIndex <= iterations) {
        for (let i = 0; i < toolNames.length; i++) {
          const id = `tc${callIndex}-${i}`
          yield { type: 'tool_call_start' as const, id, name: toolNames[i] }
          yield { type: 'tool_call_delta' as const, id, argsDelta: '{}' }
          yield { type: 'tool_call_end' as const, id }
        }
        yield { type: 'done' as const }
      } else {
        yield { type: 'text' as const, delta: 'done' }
        yield { type: 'done' as const }
      }
    },
  }
}

describe('Parallel tool execution', () => {
  it('executes multiple tool calls concurrently when parallelToolCalls is true', async () => {
    const startTimes: number[] = []
    const endTimes: number[] = []
    const tools = new ToolRegistry()

    tools.register({
      name: 'slow_a',
      description: 'slow a',
      inputSchema: {},
      execute: async () => {
        startTimes.push(Date.now())
        await new Promise(r => setTimeout(r, 100))
        endTimes.push(Date.now())
        return 'a'
      },
    })
    tools.register({
      name: 'slow_b',
      description: 'slow b',
      inputSchema: {},
      execute: async () => {
        startTimes.push(Date.now())
        await new Promise(r => setTimeout(r, 100))
        endTimes.push(Date.now())
        return 'b'
      },
    })

    const provider = multiToolProvider(['slow_a', 'slow_b'])
    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 5, parallelToolCalls: true })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.iterations).toBe(2)
    expect(startTimes).toHaveLength(2)
    expect(endTimes).toHaveLength(2)
    expect(startTimes[1]).toBeLessThan(endTimes[0])
  })

  it('preserves tool result ordering even with parallel execution', async () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'fast', description: 'fast', inputSchema: {}, execute: async () => 'fast_result' })
    tools.register({
      name: 'slow', description: 'slow', inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 50)); return 'slow_result' },
    })

    const provider = multiToolProvider(['slow', 'fast'])
    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 5, parallelToolCalls: true })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults[0].content).toBe('slow_result')
    expect(toolResults[1].content).toBe('fast_result')
  })

  it('falls back to sequential when parallelToolCalls is false', async () => {
    const startTimes: number[] = []
    const endTimes: number[] = []
    const tools = new ToolRegistry()

    for (const name of ['slow_a', 'slow_b']) {
      tools.register({
        name, description: name, inputSchema: {},
        execute: async () => { startTimes.push(Date.now()); await new Promise(r => setTimeout(r, 50)); endTimes.push(Date.now()); return name },
      })
    }

    const provider = multiToolProvider(['slow_a', 'slow_b'])
    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 5, parallelToolCalls: false })
    await loop.run([{ role: 'user', content: 'go' }])

    expect(startTimes[1]).toBeGreaterThanOrEqual(endTimes[0])
  })

  it('denied tools produce error messages while approved tools execute in parallel', async () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'allowed', description: 'ok', inputSchema: {}, execute: async () => 'result' })
    tools.register({ name: 'blocked', description: 'no', inputSchema: {}, execute: async () => 'should not run' })

    const provider = multiToolProvider(['allowed', 'blocked'])
    const loop = new AgentLoop({
      provider, tools, model: 'test', maxIterations: 5, parallelToolCalls: true,
      middleware: {
        beforeToolExecution: [async (ctx) => { if (ctx.toolCall.name === 'blocked') ctx.deny('not allowed') }],
      },
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.find(m => m.content === 'not allowed')?.isError).toBe(true)
    expect(toolResults.find(m => m.content === 'result')?.isError).toBeUndefined()
  })
})

describe('Token budget enforcement', () => {
  it('stops the loop when token budget is exceeded', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'tool_call_start' as const, id: 'tc1', name: 'noop' }
        yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: 'tc1' }
        yield { type: 'done' as const, usage: { inputTokens: 500, outputTokens: 500 } }
      },
    }
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 100, tokenBudget: 1500 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.stopReason).toBe('token_budget')
    expect(result.iterations).toBeLessThanOrEqual(2)
  })

  it('does not enforce when tokenBudget is 0 (default)', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hi' }, { type: 'done', usage: { inputTokens: 99999, outputTokens: 99999 } }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), model: 'test' })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })
})

describe('Graceful stop', () => {
  it('finishes the current iteration then stops when stop is called', async () => {
    let iterationCount = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'tool_call_start' as const, id: `tc${++iterationCount}`, name: 'noop' }
        yield { type: 'tool_call_delta' as const, id: `tc${iterationCount}`, argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: `tc${iterationCount}` }
        yield { type: 'done' as const }
      },
    }
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const loop = new AgentLoop({
      provider, tools, model: 'test', maxIterations: 100,
      middleware: { afterLoopIteration: [async (ctx) => { if (ctx.iteration >= 2) ctx.stop('enough') }] },
    })

    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.stopReason).toBe('enough')
    expect(result.iterations).toBe(2)
  })

  it('graceful stop does not abort the current stream — loop finishes normally', async () => {
    const events: string[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'text' as const, delta: 'hello' }
        yield { type: 'done' as const }
      },
    }

    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(), model: 'test', maxIterations: 5,
      middleware: {
        beforeModelCall: [async (ctx) => { events.push('beforeModelCall'); ctx.stop('stopping') }],
        afterModelResponse: [async () => { events.push('afterModelResponse') }],
        afterLoopIteration: [async () => { events.push('afterLoopIteration') }],
      },
    })

    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(events).toContain('afterModelResponse')
    expect(events).toContain('afterLoopIteration')
    expect(result.stopReason).toBe('stopping')
  })

  it('stop with immediate: true aborts mid-stream', async () => {
    let modelCalls = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        modelCalls++
        yield { type: 'tool_call_start' as const, id: 'tc1', name: 'noop' }
        yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: 'tc1' }
        yield { type: 'done' as const }
      },
    }
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })

    const loop = new AgentLoop({
      provider, tools, model: 'test', maxIterations: 10,
      middleware: { afterModelResponse: [async (ctx) => { ctx.stop('halt', { immediate: true }) }] },
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.stopReason).toBe('halt')
    expect(modelCalls).toBe(1)
  })
})

describe('maxDuration', () => {
  it('stops the loop when wall-clock time exceeds maxDuration', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'tool_call_start' as const, id: 'tc1', name: 'slow' }
        yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: 'tc1' }
        yield { type: 'done' as const }
      },
    }
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow', description: 'slow', inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 80)); return 'ok' },
    })

    const loop = new AgentLoop({ provider, tools, model: 'test', maxIterations: 100, maxDuration: 150 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.stopReason).toBe('max_duration')
    expect(result.iterations).toBeGreaterThanOrEqual(1)
    expect(result.iterations).toBeLessThanOrEqual(3)
  })

  it('does not enforce when maxDuration is 0 (default)', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), model: 'test' })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })
})

describe('elapsedMs on LoopContext', () => {
  it('provides elapsed time in middleware contexts', async () => {
    let capturedElapsed = -1
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(), model: 'test',
      middleware: { afterModelResponse: [async (ctx) => { capturedElapsed = ctx.loop.elapsedMs }] },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(capturedElapsed).toBeGreaterThanOrEqual(0)
  })
})
