import { describe, it, expect } from 'bun:test'
import { AgentLoop } from '../../src/agent/loop'
import type { IProvider, StreamChunk, ChatRequest } from '../../src/providers/types'
import { ToolRegistry } from '../../src/agent/tool-registry'

function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text', delta: 'done' }, { type: 'done' }]
      for (const chunk of chunks) yield chunk
    },
  }
}

describe('AgentLoop', () => {
  it('runs single turn with no tool calls', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done' }]])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.messages.at(-1)?.content).toBe('hello')
    expect(result.iterations).toBe(1)
  })

  it('executes tool calls and loops', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'add' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"a":1,"b":2}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'result is 3' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'add', description: 'add', inputSchema: {}, execute: async (input: any) => input.a + input.b })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'add 1+2' }])
    expect(result.iterations).toBe(2)
  })

  it('respects maxIterations', async () => {
    const infiniteToolCall: StreamChunk[] = [
      { type: 'tool_call_start', id: 'tc1', name: 'noop' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'tool_call_end', id: 'tc1' },
      { type: 'done' },
    ]
    const provider = mockProvider(Array(100).fill(infiniteToolCall))
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 3 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.iterations).toBeLessThanOrEqual(3)
  })

  it('passes thinking to ChatRequest', async () => {
    const capturedRequests: ChatRequest[] = []
    const mockProvider = {
      name: 'mock',
      stream: async function*(req: ChatRequest) {
        capturedRequests.push(req)
        yield { type: 'done' as const }
      },
      chat: async () => ({ message: { role: 'assistant' as const, content: '' } }),
    }
    const tools = new ToolRegistry()
    const loop = new AgentLoop({ provider: mockProvider, tools, model: 'test', thinking: 'low' })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(capturedRequests[0]?.thinking).toBe('low')
  })

  it('runs middleware at lifecycle points', async () => {
    const events: string[] = []
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      maxIterations: 10,
      middleware: {
        beforeLoopBegin: [async (_ctx) => { events.push('beforeLoopBegin') }],
        beforeModelCall: [async (_ctx) => { events.push('beforeModelCall') }],
        afterModelResponse: [async (_ctx) => { events.push('afterModelResponse') }],
        afterLoopIteration: [async (_ctx) => { events.push('afterLoopIteration') }],
        afterLoopComplete: [async (_ctx) => { events.push('afterLoopComplete') }],
        onStreamChunk: [],
        beforeToolExecution: [],
        afterToolExecution: [],
        onError: [],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(events).toContain('beforeLoopBegin')
    expect(events).toContain('beforeModelCall')
    expect(events).toContain('afterModelResponse')
    expect(events).toContain('afterLoopIteration')
    expect(events).toContain('afterLoopComplete')
  })

  it('onStreamChunk fires for each text chunk with correct delta', async () => {
    const chunks: string[] = []
    const provider = mockProvider([[
      { type: 'text', delta: 'hello' },
      { type: 'text', delta: ' world' },
      { type: 'done' },
    ]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      middleware: { onStreamChunk: [async (ctx) => { if (ctx.chunk.type === 'text' || ctx.chunk.type === 'thinking') chunks.push(ctx.chunk.delta) }] },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(chunks).toEqual(['hello', ' world'])
  })

  it('beforeToolExecution receives correct toolCall name and args', async () => {
    const seen: { name: string; args: string }[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'add' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"a":1}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'add', description: '', inputSchema: {}, execute: async () => 42 })
    const loop = new AgentLoop({
      provider, tools,
      middleware: { beforeToolExecution: [async (ctx) => { seen.push({ name: ctx.toolCall.name, args: ctx.toolCall.arguments }) }] },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(seen).toHaveLength(1)
    expect(seen[0]!.name).toBe('add')
    expect(seen[0]!.args).toBe('{"a":1}')
  })

  it('afterToolExecution receives tool result content', async () => {
    const results: string[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'echo' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'echo', description: '', inputSchema: {}, execute: async () => 'hello from tool' })
    const loop = new AgentLoop({
      provider, tools,
      middleware: { afterToolExecution: [async (ctx) => { results.push(ctx.result.content as string) }] },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(results).toEqual(['hello from tool'])
  })

  it('onError fires when provider throws', async () => {
    const errors: string[] = []
    const failProvider: IProvider = {
      name: 'fail',
      chat: async () => { throw new Error('provider down') },
      async *stream() { throw new Error('provider down') },
    }
    const loop = new AgentLoop({
      provider: failProvider, tools: new ToolRegistry(),
      middleware: { onError: [async (ctx) => { errors.push(ctx.error.message) }] },
    })
    await expect(loop.run([{ role: 'user', content: 'hi' }])).rejects.toThrow('provider down')
    expect(errors).toEqual(['provider down'])
  })

  it('afterLoopComplete is NOT called when stop() is used', async () => {
    const events: string[] = []
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      middleware: {
        beforeModelCall: [async (ctx) => { ctx.stop() }],
        afterLoopComplete: [async (_ctx) => { events.push('afterLoopComplete') }],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(events).not.toContain('afterLoopComplete')
  })

  it('afterLoopComplete IS called on normal completion', async () => {
    const events: string[] = []
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      middleware: { afterLoopComplete: [async (_ctx) => { events.push('afterLoopComplete') }] },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(events).toContain('afterLoopComplete')
  })

  it('multiple handlers on same hook all run in order', async () => {
    const order: number[] = []
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      middleware: {
        beforeModelCall: [
          async (_ctx) => { order.push(1) },
          async (_ctx) => { order.push(2) },
          async (_ctx) => { order.push(3) },
        ],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(order).toEqual([1, 2, 3])
  })

  it('ctx.iteration increments correctly each loop', async () => {
    const iterations: number[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'noop' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({
      provider, tools,
      middleware: { afterLoopIteration: [async (ctx) => { iterations.push(ctx.iteration) }] },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(iterations).toEqual([1, 2])
  })

  it('ctx.signal is the same object across all hooks in a single run', async () => {
    const signals: AbortSignal[] = []
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      middleware: {
        beforeLoopBegin: [async (ctx) => { signals.push(ctx.signal) }],
        beforeModelCall: [async (ctx) => { signals.push(ctx.signal) }],
        afterLoopComplete: [async (ctx) => { signals.push(ctx.signal) }],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(signals).toHaveLength(3)
    expect(signals[0]).toBe(signals[1])
    expect(signals[1]).toBe(signals[2])
  })

  it('stop() in beforeLoopBegin means 0 model calls and 0 assistant messages', async () => {
    let modelCalls = 0
    const countProvider: IProvider = {
      name: 'count',
      chat: async () => { throw new Error() },
      async *stream() { modelCalls++; yield { type: 'done' as const } },
    }
    const loop = new AgentLoop({
      provider: countProvider, tools: new ToolRegistry(),
      middleware: { beforeLoopBegin: [async (ctx) => { ctx.stop() }] },
    })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(modelCalls).toBe(0)
    expect(result.messages.filter(m => m.role === 'assistant')).toHaveLength(0)
  })

  it('stop() in afterModelResponse prevents tool execution', async () => {
    let toolCalls = 0
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'count' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'count', description: '', inputSchema: {}, execute: async () => { toolCalls++; return 'ok' } })
    const loop = new AgentLoop({
      provider, tools,
      middleware: { afterModelResponse: [async (ctx) => { ctx.stop() }] },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(toolCalls).toBe(0)
  })

  it('each run() call gets an independent AbortController', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'run1' }, { type: 'done' }],
      [{ type: 'text', delta: 'run2' }, { type: 'done' }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry() })
    const r1 = await loop.run([{ role: 'user', content: 'first' }])
    const r2 = await loop.run([{ role: 'user', content: 'second' }])
    expect(r1.messages.at(-1)?.content).toBe('run1')
    expect(r2.messages.at(-1)?.content).toBe('run2')
  })
})
