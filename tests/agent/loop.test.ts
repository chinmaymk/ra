import { describe, it, expect } from 'bun:test'
import { AgentLoop } from '../../src/agent/loop'
import type { IProvider, StreamChunk, ChatRequest, ChatResponse } from '../../src/providers/types'
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

/** Tool call stream chunks for a single tool invocation */
const tc = (id: string, name: string, args = '{}'): StreamChunk[] => [
  { type: 'tool_call_start', id, name },
  { type: 'tool_call_delta', id, argsDelta: args },
  { type: 'done' },
]

const textDone = (text: string): StreamChunk[] => [{ type: 'text', delta: text }, { type: 'done' }]

function regTool(tools: ToolRegistry, name: string, fn: (input: any) => any = async () => 'ok') {
  tools.register({ name, description: '', inputSchema: {}, execute: fn })
}

describe('AgentLoop', () => {
  it('runs single turn with no tool calls', async () => {
    const loop = new AgentLoop({ provider: mockProvider([textDone('hello')]), tools: new ToolRegistry(), maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.messages.at(-1)?.content).toBe('hello')
    expect(result.iterations).toBe(1)
  })

  it('executes tool calls and loops', async () => {
    const provider = mockProvider([
      [{ type: 'tool_call_start', id: 'tc1', name: 'add' }, { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"a":1,"b":2}' }, { type: 'tool_call_end', id: 'tc1' }, { type: 'done' }],
      textDone('result is 3'),
    ])
    const tools = new ToolRegistry()
    regTool(tools, 'add', async (input: any) => input.a + input.b)
    const result = await new AgentLoop({ provider, tools, maxIterations: 10 }).run([{ role: 'user', content: 'add 1+2' }])
    expect(result.iterations).toBe(2)
  })

  it('respects maxIterations', async () => {
    const provider = mockProvider(Array(100).fill([...tc('tc1', 'noop'), { type: 'tool_call_end', id: 'tc1' }]))
    const tools = new ToolRegistry()
    regTool(tools, 'noop')
    const result = await new AgentLoop({ provider, tools, maxIterations: 3 }).run([{ role: 'user', content: 'go' }])
    expect(result.iterations).toBeLessThanOrEqual(3)
  })

  it('passes thinking to ChatRequest', async () => {
    const capturedRequests: ChatRequest[] = []
    const capProvider = {
      name: 'mock',
      stream: async function*(req: ChatRequest) { capturedRequests.push(req); yield { type: 'done' as const } },
      chat: async () => ({ message: { role: 'assistant' as const, content: '' } }),
    }
    await new AgentLoop({ provider: capProvider, tools: new ToolRegistry(), model: 'test', thinking: 'low' }).run([{ role: 'user', content: 'hi' }])
    expect(capturedRequests[0]?.thinking).toBe('low')
  })

  it('runs middleware at lifecycle points', async () => {
    const events: string[] = []
    const loop = new AgentLoop({
      provider: mockProvider([textDone('hi')]), tools: new ToolRegistry(), maxIterations: 10,
      middleware: {
        beforeLoopBegin: [async () => { events.push('beforeLoopBegin') }],
        beforeModelCall: [async () => { events.push('beforeModelCall') }],
        afterModelResponse: [async () => { events.push('afterModelResponse') }],
        afterLoopIteration: [async () => { events.push('afterLoopIteration') }],
        afterLoopComplete: [async () => { events.push('afterLoopComplete') }],
        onStreamChunk: [], beforeToolExecution: [], afterToolExecution: [], onError: [],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    for (const e of ['beforeLoopBegin', 'beforeModelCall', 'afterModelResponse', 'afterLoopIteration', 'afterLoopComplete']) {
      expect(events).toContain(e)
    }
  })

  it('onStreamChunk fires for each text chunk', async () => {
    const chunks: string[] = []
    const loop = new AgentLoop({
      provider: mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'text', delta: ' world' }, { type: 'done' }]]),
      tools: new ToolRegistry(),
      middleware: { onStreamChunk: [async (ctx) => { if (ctx.chunk.type === 'text' || ctx.chunk.type === 'thinking') chunks.push(ctx.chunk.delta) }] },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(chunks).toEqual(['hello', ' world'])
  })

  it('beforeToolExecution receives correct toolCall name and args', async () => {
    const seen: { name: string; args: string }[] = []
    const tools = new ToolRegistry()
    regTool(tools, 'add', async () => 42)
    const loop = new AgentLoop({
      provider: mockProvider([tc('tc1', 'add', '{"a":1}'), textDone('done')]), tools,
      middleware: { beforeToolExecution: [async (ctx) => { seen.push({ name: ctx.toolCall.name, args: ctx.toolCall.arguments }) }] },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(seen[0]).toEqual({ name: 'add', args: '{"a":1}' })
  })

  it('afterToolExecution receives tool result content', async () => {
    const results: string[] = []
    const tools = new ToolRegistry()
    regTool(tools, 'echo', async () => 'hello from tool')
    const loop = new AgentLoop({
      provider: mockProvider([tc('tc1', 'echo'), textDone('done')]), tools,
      middleware: { afterToolExecution: [async (ctx) => { results.push(ctx.result.content as string) }] },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(results).toEqual(['hello from tool'])
  })

  it('onError fires when provider throws', async () => {
    const errors: string[] = []
    const failProvider: IProvider = { name: 'fail', chat: async () => { throw new Error('provider down') }, async *stream() { throw new Error('provider down') } }
    const loop = new AgentLoop({ provider: failProvider, tools: new ToolRegistry(), middleware: { onError: [async (ctx) => { errors.push(ctx.error.message) }] } })
    await expect(loop.run([{ role: 'user', content: 'hi' }])).rejects.toThrow('provider down')
    expect(errors).toEqual(['provider down'])
  })

  it('afterLoopComplete is NOT called when stop() is used', async () => {
    const events: string[] = []
    const loop = new AgentLoop({
      provider: mockProvider([textDone('hi')]), tools: new ToolRegistry(),
      middleware: { beforeModelCall: [async (ctx) => { ctx.stop() }], afterLoopComplete: [async () => { events.push('afterLoopComplete') }] },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(events).not.toContain('afterLoopComplete')
  })

  it('afterLoopComplete IS called on normal completion', async () => {
    const events: string[] = []
    const loop = new AgentLoop({
      provider: mockProvider([textDone('hi')]), tools: new ToolRegistry(),
      middleware: { afterLoopComplete: [async () => { events.push('afterLoopComplete') }] },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(events).toContain('afterLoopComplete')
  })

  it('multiple handlers on same hook all run in order', async () => {
    const order: number[] = []
    const loop = new AgentLoop({
      provider: mockProvider([textDone('hi')]), tools: new ToolRegistry(),
      middleware: { beforeModelCall: [async () => { order.push(1) }, async () => { order.push(2) }, async () => { order.push(3) }] },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(order).toEqual([1, 2, 3])
  })

  it('ctx.iteration increments correctly each loop', async () => {
    const iterations: number[] = []
    const tools = new ToolRegistry()
    regTool(tools, 'noop')
    const loop = new AgentLoop({
      provider: mockProvider([tc('tc1', 'noop'), textDone('done')]), tools,
      middleware: { afterLoopIteration: [async (ctx) => { iterations.push(ctx.iteration) }] },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(iterations).toEqual([1, 2])
  })

  it('ctx.signal is the same object across all hooks', async () => {
    const signals: AbortSignal[] = []
    const loop = new AgentLoop({
      provider: mockProvider([textDone('hi')]), tools: new ToolRegistry(),
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

  it('stop() in beforeLoopBegin means 0 model calls', async () => {
    let modelCalls = 0
    const loop = new AgentLoop({
      provider: { name: 'count', chat: async () => { throw new Error() }, async *stream() { modelCalls++; yield { type: 'done' as const } } },
      tools: new ToolRegistry(), middleware: { beforeLoopBegin: [async (ctx) => { ctx.stop() }] },
    })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(modelCalls).toBe(0)
    expect(result.messages.filter(m => m.role === 'assistant')).toHaveLength(0)
  })

  it('stop() in afterModelResponse prevents tool execution', async () => {
    let toolCalls = 0
    const tools = new ToolRegistry()
    regTool(tools, 'count', async () => { toolCalls++; return 'ok' })
    await new AgentLoop({
      provider: mockProvider([tc('tc1', 'count')]), tools,
      middleware: { afterModelResponse: [async (ctx) => { ctx.stop() }] },
    }).run([{ role: 'user', content: 'go' }])
    expect(toolCalls).toBe(0)
  })

  it('each run() call gets an independent AbortController', async () => {
    const loop = new AgentLoop({ provider: mockProvider([textDone('run1'), textDone('run2')]), tools: new ToolRegistry() })
    expect((await loop.run([{ role: 'user', content: 'first' }])).messages.at(-1)?.content).toBe('run1')
    expect((await loop.run([{ role: 'user', content: 'second' }])).messages.at(-1)?.content).toBe('run2')
  })

  it('calls afterToolExecution with isError when tool throws', async () => {
    const afterResults: { isError: boolean; content: string }[] = []
    const tools = new ToolRegistry()
    regTool(tools, 'failing', async () => { throw new Error('tool exploded') })
    await new AgentLoop({
      provider: mockProvider([tc('tc1', 'failing'), textDone('done')]), tools,
      middleware: { afterToolExecution: [async (ctx) => { afterResults.push({ isError: ctx.result.isError ?? false, content: ctx.result.content as string }) }] },
    }).run([{ role: 'user', content: 'go' }])
    expect(afterResults).toHaveLength(1)
    expect(afterResults[0]!.isError).toBe(true)
    expect(afterResults[0]!.content).toBe('tool exploded')
  })

  it('tool errors are handled internally, not propagated to onError', async () => {
    const errorPhases: string[] = []
    const tools = new ToolRegistry()
    regTool(tools, 'failing', async () => { throw new Error('tool error') })
    await new AgentLoop({
      provider: mockProvider([tc('tc1', 'failing')]), tools,
      middleware: { onError: [async (ctx) => { errorPhases.push(ctx.phase) }] },
    }).run([{ role: 'user', content: 'go' }])
    expect(errorPhases).toHaveLength(0)
  })

  it('compaction persists across loop iterations', async () => {
    let streamCallCount = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => ({ message: { role: 'assistant', content: 'Summary.' } }),
      async *stream() {
        streamCallCount++
        if (streamCallCount <= 3) { yield* tc(`tc${streamCallCount}`, 'echo') }
        else { yield* textDone('done') }
      },
    }
    const tools = new ToolRegistry()
    regTool(tools, 'echo', async () => 'x'.repeat(800))
    const result = await new AgentLoop({ provider, tools, maxIterations: 10, compaction: { enabled: true, threshold: 0.8, maxTokens: 100, contextWindow: 500 } })
      .run([{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'Do things' }])
    expect(result.messages.length).toBeLessThan(9)
  })

  it('handles parallel tool calls — both execute and both results returned', async () => {
    const executedTools: string[] = []
    const provider = mockProvider([
      [{ type: 'tool_call_start', id: 'tc1', name: 'tool_a' }, { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"x":1}' },
       { type: 'tool_call_start', id: 'tc2', name: 'tool_b' }, { type: 'tool_call_delta', id: 'tc2', argsDelta: '{"y":2}' }, { type: 'done' }],
      textDone('both done'),
    ])
    const tools = new ToolRegistry()
    regTool(tools, 'tool_a', async () => { executedTools.push('a'); return 'result_a' })
    regTool(tools, 'tool_b', async () => { executedTools.push('b'); return 'result_b' })
    const result = await new AgentLoop({ provider, tools, maxIterations: 10 }).run([{ role: 'user', content: 'go' }])
    expect(executedTools).toContain('a')
    expect(executedTools).toContain('b')
    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
  })

  it('unknown tool name produces isError tool result', async () => {
    const result = await new AgentLoop({ provider: mockProvider([tc('tc1', 'nonexistent_tool'), textDone('handled')]), tools: new ToolRegistry(), maxIterations: 10 })
      .run([{ role: 'user', content: 'use unknown tool' }])
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect((toolResult as any).isError).toBe(true)
    expect(toolResult!.content).toContain('nonexistent_tool')
  })

  it('tracks token usage in LoopResult', async () => {
    const result = await new AgentLoop({ provider: mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } }]]), tools: new ToolRegistry(), maxIterations: 10 })
      .run([{ role: 'user', content: 'hi' }])
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  it('accumulates token usage across iterations', async () => {
    const tools = new ToolRegistry()
    regTool(tools, 'noop')
    const provider = mockProvider([
      [...tc('tc1', 'noop').slice(0, -1), { type: 'done', usage: { inputTokens: 100, outputTokens: 30 } } as StreamChunk],
      [{ type: 'text', delta: 'done' }, { type: 'done', usage: { inputTokens: 200, outputTokens: 40 } }],
    ])
    const result = await new AgentLoop({ provider, tools, maxIterations: 10 }).run([{ role: 'user', content: 'go' }])
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 70 })
  })

  it('exposes lastUsage and cumulative usage to middleware', async () => {
    const usages: { last: any; cumulative: any }[] = []
    const tools = new ToolRegistry()
    regTool(tools, 'noop')
    const provider = mockProvider([
      [...tc('tc1', 'noop').slice(0, -1), { type: 'done', usage: { inputTokens: 100, outputTokens: 30 } } as StreamChunk],
      [{ type: 'text', delta: 'done' }, { type: 'done', usage: { inputTokens: 200, outputTokens: 40 } }],
    ])
    await new AgentLoop({
      provider, tools, maxIterations: 10,
      middleware: { afterModelResponse: [async (ctx) => { usages.push({ last: ctx.loop.lastUsage, cumulative: { ...ctx.loop.usage } }) }] },
    }).run([{ role: 'user', content: 'go' }])
    expect(usages[0]!.last).toEqual({ inputTokens: 100, outputTokens: 30 })
    expect(usages[0]!.cumulative).toEqual({ inputTokens: 100, outputTokens: 30 })
    expect(usages[1]!.cumulative).toEqual({ inputTokens: 300, outputTokens: 70 })
  })

  it('handles missing usage in done chunk gracefully', async () => {
    const result = await new AgentLoop({ provider: mockProvider([textDone('hello')]), tools: new ToolRegistry(), maxIterations: 10 })
      .run([{ role: 'user', content: 'hi' }])
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it('malformed tool args are handled as empty object', async () => {
    let receivedInput: unknown
    const tools = new ToolRegistry()
    regTool(tools, 'capture', async (input) => { receivedInput = input; return 'ok' })
    await new AgentLoop({
      provider: mockProvider([[{ type: 'tool_call_start', id: 'tc1', name: 'capture' }, { type: 'tool_call_delta', id: 'tc1', argsDelta: 'not valid json{{{' }, { type: 'done' }], textDone('ok')]),
      tools, maxIterations: 10,
    }).run([{ role: 'user', content: 'go' }])
    expect(receivedInput).toEqual({})
  })

  it('tool timeout returns error message to LLM', async () => {
    const tools = new ToolRegistry()
    tools.register({ name: 'slow_tool', description: 'hangs', inputSchema: { type: 'object' }, execute: () => new Promise(resolve => setTimeout(() => resolve('done'), 5000)) })
    const result = await new AgentLoop({ provider: mockProvider([tc('tc1', 'slow_tool'), textDone('ok')]), tools, toolTimeout: 50 })
      .run([{ role: 'user', content: 'test' }])
    const toolMsg = result.messages.find(m => m.role === 'tool')
    expect(toolMsg?.content).toContain('timed out after 50ms')
    expect((toolMsg as any)?.isError).toBe(true)
  })

  it('compacts messages when exceeding token threshold', async () => {
    let chatCallCount = 0, streamCallCount = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => { chatCallCount++; return { message: { role: 'assistant', content: 'Summary.' } } },
      async *stream() {
        streamCallCount++
        if (streamCallCount <= 5) { yield* tc(`tc${streamCallCount}`, 'echo') }
        else { yield* textDone('final answer') }
      },
    }
    const tools = new ToolRegistry()
    regTool(tools, 'echo', async () => 'x'.repeat(400))
    const result = await new AgentLoop({ provider, tools, maxIterations: 10, compaction: { enabled: true, threshold: 0.8, maxTokens: 200, contextWindow: 1000 } })
      .run([{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'Do things' }])
    expect(chatCallCount).toBeGreaterThan(0)
    expect(result.messages.at(-1)?.content).toBe('final answer')
  })
})
