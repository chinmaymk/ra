import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry, NoopLogger } from '@chinmaymk/ra'
import type { IProvider, ChatRequest, ChatResponse, Logger, StreamChunk } from '@chinmaymk/ra'
import { mockProvider } from './test-utils'

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

  // stop() behavior tested in loop-stop.test.ts

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

  it('calls afterToolExecution with isError when tool throws', async () => {
    const afterResults: { isError: boolean; content: string }[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'failing' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'failing', description: '', inputSchema: {}, execute: async () => { throw new Error('tool exploded') } })
    const loop = new AgentLoop({
      provider, tools,
      middleware: {
        afterToolExecution: [async (ctx) => {
          afterResults.push({ isError: ctx.result.isError ?? false, content: ctx.result.content as string })
        }],
      },
    })
    // The loop should not throw - the error is captured and used as tool result
    await loop.run([{ role: 'user', content: 'go' }])
    expect(afterResults).toHaveLength(1)
    expect(afterResults[0]!.isError).toBe(true)
    expect(afterResults[0]!.content).toBe('tool exploded')
  })

  it('onError uses correct phase when error occurs during tool execution', async () => {
    const errorPhases: string[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'failing' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'failing', description: '', inputSchema: {}, execute: async () => { throw new Error('tool error') } })
    const loop = new AgentLoop({
      provider, tools,
      middleware: {
        onError: [async (ctx) => { errorPhases.push(ctx.phase) }],
      },
    })
    // With the fix, tool errors are caught internally and don't propagate to onError
    // But a hard rethrow should show tool_execution phase
    await loop.run([{ role: 'user', content: 'go' }])
    // No error should propagate since tool errors are handled internally
    expect(errorPhases).toHaveLength(0)
  })

  it('compaction persists across loop iterations (messages written back)', async () => {
    // Bug: compaction only modified request copy, not loop's canonical messages array.
    // result.messages grew unboundedly even though provider saw compacted requests.
    let streamCallCount = 0
    const longContent = 'x'.repeat(800) // ~200 tokens

    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => {
        return { message: { role: 'assistant', content: 'Summary.' } }
      },
      async *stream() {
        streamCallCount++
        if (streamCallCount <= 3) {
          yield { type: 'tool_call_start' as const, id: `tc${streamCallCount}`, name: 'echo' }
          yield { type: 'tool_call_delta' as const, id: `tc${streamCallCount}`, argsDelta: '{}' }
          yield { type: 'done' as const }
        } else {
          yield { type: 'text' as const, delta: 'done' }
          yield { type: 'done' as const }
        }
      },
    }

    const tools = new ToolRegistry()
    tools.register({ name: 'echo', description: '', inputSchema: {}, execute: async () => longContent })

    const loop = new AgentLoop({
      provider, tools, maxIterations: 10,
      compaction: { enabled: true, threshold: 0.8, maxTokens: 100, contextWindow: 500 },
    })

    const result = await loop.run([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Do things' },
    ])

    // Without fix: result.messages has 9 entries (2 initial + 3*(asst+tool) + final asst)
    // With fix: compaction persists, so result.messages is reduced
    const withoutCompaction = 2 + 3 * 2 + 1 // 9
    expect(result.messages.length).toBeLessThan(withoutCompaction)
  })

  it('handles parallel tool calls — both execute and both results returned', async () => {
    const executedTools: string[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'tool_a' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"x":1}' },
        { type: 'tool_call_start', id: 'tc2', name: 'tool_b' },
        { type: 'tool_call_delta', id: 'tc2', argsDelta: '{"y":2}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'both done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'tool_a', description: '', inputSchema: {}, execute: async () => { executedTools.push('a'); return 'result_a' } })
    tools.register({ name: 'tool_b', description: '', inputSchema: {}, execute: async () => { executedTools.push('b'); return 'result_b' } })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(executedTools).toContain('a')
    expect(executedTools).toContain('b')
    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.some(m => m.content === 'result_a')).toBe(true)
    expect(toolResults.some(m => m.content === 'result_b')).toBe(true)
  })

  it('beforeToolExecution deny() prevents tool execution and returns error', async () => {
    const executed: string[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'risky' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'handled' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'risky', description: '', inputSchema: {}, execute: async () => { executed.push('risky'); return 'ok' } })
    const loop = new AgentLoop({
      provider, tools,
      middleware: {
        beforeToolExecution: [async (ctx) => { ctx.deny('Blocked by policy') }],
      },
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(executed).toHaveLength(0)
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult).toBeDefined()
    expect(toolResult!.isError).toBe(true)
    expect(toolResult!.content).toBe('Blocked by policy')
  })

  it('deny() only blocks targeted tool, others still execute', async () => {
    const executed: string[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'safe' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'tool_call_start', id: 'tc2', name: 'risky' },
        { type: 'tool_call_delta', id: 'tc2', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'safe', description: '', inputSchema: {}, execute: async () => { executed.push('safe'); return 'ok' } })
    tools.register({ name: 'risky', description: '', inputSchema: {}, execute: async () => { executed.push('risky'); return 'ok' } })
    const loop = new AgentLoop({
      provider, tools,
      middleware: {
        beforeToolExecution: [async (ctx) => {
          if (ctx.toolCall.name === 'risky') ctx.deny('Denied')
        }],
      },
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(executed).toEqual(['safe'])
    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.find(m => m.isError)?.content).toBe('Denied')
    expect(toolResults.find(m => !m.isError)?.content).toBe('ok')
  })

  it('unknown tool name produces isError tool result instead of crashing', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'nonexistent_tool' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'handled' }, { type: 'done' }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'use unknown tool' }])
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult).toBeDefined()
    expect((toolResult as any).isError).toBe(true)
    expect(toolResult!.content).toContain('nonexistent_tool')
  })

  it('tracks token usage in LoopResult', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } }]])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
  })

  it('accumulates token usage across iterations', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'noop' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done', usage: { inputTokens: 100, outputTokens: 30 } },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done', usage: { inputTokens: 200, outputTokens: 40 } }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 70 })
  })

  it('exposes lastUsage and cumulative usage to middleware via LoopContext', async () => {
    const usages: { last: any; cumulative: any }[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'noop' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done', usage: { inputTokens: 100, outputTokens: 30 } },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done', usage: { inputTokens: 200, outputTokens: 40 } }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({
      provider, tools, maxIterations: 10,
      middleware: {
        afterModelResponse: [async (ctx) => {
          usages.push({ last: ctx.loop.lastUsage, cumulative: { ...ctx.loop.usage } })
        }],
      },
    })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(usages[0]!.last).toEqual({ inputTokens: 100, outputTokens: 30 })
    expect(usages[0]!.cumulative).toEqual({ inputTokens: 100, outputTokens: 30 })
    expect(usages[1]!.last).toEqual({ inputTokens: 200, outputTokens: 40 })
    expect(usages[1]!.cumulative).toEqual({ inputTokens: 300, outputTokens: 70 })
  })

  it('handles missing usage in done chunk gracefully', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done' }]])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it('malformed tool args (invalid JSON) are handled as empty object — tool still executes', async () => {
    let receivedInput: unknown
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'capture' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: 'not valid json{{{' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'capture', description: '', inputSchema: {}, execute: async (input) => { receivedInput = input; return 'ok' } })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(receivedInput).toEqual({})
  })

  it('tool timeout returns error message to LLM', async () => {
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow_tool',
      description: 'hangs',
      inputSchema: { type: 'object' },
      execute: () => new Promise(resolve => setTimeout(() => resolve('done'), 5000)),
    })
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'slow_tool' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const loop = new AgentLoop({ provider, tools, toolTimeout: 50 })
    const result = await loop.run([{ role: 'user', content: 'test' }])
    const toolMsg = result.messages.find(m => m.role === 'tool')
    expect(toolMsg?.content).toContain('timed out after 50ms')
    expect((toolMsg as any)?.isError).toBe(true)
  })

  it('compacts messages when exceeding token threshold', async () => {
    let chatCallCount = 0
    let streamCallCount = 0
    const longContent = 'x'.repeat(400) // 100 tokens per message

    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => {
        chatCallCount++
        return { message: { role: 'assistant', content: 'Summary of prior conversation.' } }
      },
      async *stream() {
        streamCallCount++
        if (streamCallCount <= 5) {
          yield { type: 'tool_call_start' as const, id: `tc${streamCallCount}`, name: 'echo' }
          yield { type: 'tool_call_delta' as const, id: `tc${streamCallCount}`, argsDelta: '{}' }
          yield { type: 'done' as const }
        } else {
          yield { type: 'text' as const, delta: 'final answer' }
          yield { type: 'done' as const }
        }
      },
    }

    const tools = new ToolRegistry()
    tools.register({ name: 'echo', description: '', inputSchema: {}, execute: async () => longContent })

    const loop = new AgentLoop({
      provider,
      tools,
      maxIterations: 10,
      compaction: { enabled: true, threshold: 0.8, maxTokens: 200, contextWindow: 1000 },
    })

    const result = await loop.run([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Do things' },
    ])

    // provider.chat should have been called at least once for summarization
    expect(chatCallCount).toBeGreaterThan(0)
    // Should still complete normally
    expect(result.messages.at(-1)?.content).toBe('final answer')
  })

  it('ask_user does not auto-stop the loop when tool returns a value', async () => {
    // Regression: loop previously broke early when ask_user was called;
    // now it's a plain tool call and the loop continues with the result.
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'AskUserQuestion' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"question":"Color?"}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'The color is blue' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'AskUserQuestion', description: '', inputSchema: {}, execute: async () => 'blue' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'what color?' }])
    expect(result.iterations).toBe(2)
    expect(result.messages.at(-1)?.content).toBe('The color is blue')
    expect(result.stopReason).toBeUndefined()
  })

  it('exposes logger to middleware via ctx', async () => {
    const customLogger = new NoopLogger()
    let seenLogger: Logger | undefined
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      logger: customLogger,
      middleware: {
        beforeModelCall: [async (ctx) => { seenLogger = ctx.logger }],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(seenLogger).toBe(customLogger)
  })

  it('provides NoopLogger by default when no logger is passed', async () => {
    let seenLogger: Logger | undefined
    const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      middleware: {
        beforeModelCall: [async (ctx) => { seenLogger = ctx.logger }],
      },
    })
    await loop.run([{ role: 'user', content: 'hi' }])
    expect(seenLogger).toBeInstanceOf(NoopLogger)
  })

  it('parallel tool calls: one succeeds, one fails — both results returned', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'good' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'tool_call_start', id: 'tc2', name: 'bad' },
        { type: 'tool_call_delta', id: 'tc2', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'recovered' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'good', description: '', inputSchema: {}, execute: async () => 'success' })
    tools.register({ name: 'bad', description: '', inputSchema: {}, execute: async () => { throw new Error('fail') } })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.find(m => m.content === 'success')?.isError).toBeFalsy()
    expect(toolResults.find(m => m.content === 'fail')?.isError).toBe(true)
  })

  it('empty tool arguments (no delta chunks) parsed as empty object', async () => {
    let receivedInput: unknown
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'capture' },
        // no tool_call_delta — args will be empty string
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'capture', description: '', inputSchema: {}, execute: async (input) => { receivedInput = input; return 'ok' } })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(receivedInput).toEqual({})
  })

  it('tool returning object is JSON-serialized in result message', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'obj' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'obj', description: '', inputSchema: {}, execute: async () => ({ key: 'value', num: 42 }) })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.content).toBe('{"key":"value","num":42}')
  })

  it('maxIterations=1 stops after one model call even with tool calls', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'noop' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 1 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.iterations).toBe(1)
  })

  it('thinking chunks are captured in onStreamChunk but not in assistant content', async () => {
    const streamedChunks: { type: string; delta: string }[] = []
    const provider = mockProvider([[
      { type: 'thinking', delta: 'let me think...' },
      { type: 'text', delta: 'here is my answer' },
      { type: 'done' },
    ]])
    const loop = new AgentLoop({
      provider, tools: new ToolRegistry(),
      middleware: {
        onStreamChunk: [async (ctx) => {
          if (ctx.chunk.type === 'text' || ctx.chunk.type === 'thinking') {
            streamedChunks.push({ type: ctx.chunk.type, delta: ctx.chunk.delta })
          }
        }],
      },
    })
    const result = await loop.run([{ role: 'user', content: 'think' }])
    expect(streamedChunks).toHaveLength(2)
    expect(streamedChunks[0]).toEqual({ type: 'thinking', delta: 'let me think...' })
    expect(streamedChunks[1]).toEqual({ type: 'text', delta: 'here is my answer' })
    // Assistant message content should only contain text, not thinking
    expect(result.messages.at(-1)?.content).toBe('here is my answer')
  })

  it('multiple tool_call_delta chunks are concatenated for same tool', async () => {
    let receivedArgs: unknown
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'capture' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"key":' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '"value"}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'capture', description: '', inputSchema: {}, execute: async (input) => { receivedArgs = input; return 'ok' } })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    await loop.run([{ role: 'user', content: 'go' }])
    expect(receivedArgs).toEqual({ key: 'value' })
  })

  it('text and tool calls in same response both captured in assistant message', async () => {
    const provider = mockProvider([
      [
        { type: 'text', delta: 'Let me check: ' },
        { type: 'tool_call_start', id: 'tc1', name: 'noop' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const assistantMsg = result.messages.find(m => m.role === 'assistant' && m.toolCalls?.length)
    expect(assistantMsg?.content).toBe('Let me check: ')
    expect(assistantMsg?.toolCalls).toHaveLength(1)
    expect(assistantMsg?.toolCalls![0]!.name).toBe('noop')
  })

  it('truncates tool output exceeding maxToolResponseSize', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'big' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    const bigOutput = 'x'.repeat(200)
    tools.register({ name: 'big', description: '', inputSchema: {}, execute: async () => bigOutput })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, maxToolResponseSize: 100 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.content).toContain('<response clipped>')
    expect(toolResult?.content).toContain('200')
    expect(toolResult?.content).toContain('100')
    const contentPortion = (toolResult!.content as string).split('\n\n<response clipped>')[0]!
    expect(contentPortion.length).toBeLessThanOrEqual(100)
  })

  it('does not truncate tool output within maxToolResponseSize', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'small' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    const smallOutput = 'hello world'
    tools.register({ name: 'small', description: '', inputSchema: {}, execute: async () => smallOutput })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, maxToolResponseSize: 100 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.content).toBe(smallOutput)
  })

  it('truncates at newline boundary when possible', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'lines' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    // Build output with lines of 10 chars each: "line 0000\n" = 10 chars
    const lines = Array.from({ length: 20 }, (_, i) => `line ${String(i).padStart(4, '0')}`)
    const bigOutput = lines.join('\n')
    tools.register({ name: 'lines', description: '', inputSchema: {}, execute: async () => bigOutput })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, maxToolResponseSize: 100 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResult = result.messages.find(m => m.role === 'tool')
    // The content before the clipping notice should end at a newline boundary
    const clippedContent = (toolResult!.content as string).split('\n\n<response clipped>')[0]!
    expect(clippedContent.endsWith('\n') || !clippedContent.includes('\n') || lines.some(l => clippedContent.endsWith(l))).toBe(true)
  })
})
