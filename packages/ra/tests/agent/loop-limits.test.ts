import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { StreamChunk } from '@chinmaymk/ra'
import { mockProvider } from './test-utils'

/** Two parallel tool calls that log execution order via delays. */
function twoToolCallChunks(): StreamChunk[][] {
  return [
    [
      { type: 'tool_call_start', id: 'tc1', name: 'slow' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"id":"a"}' },
      { type: 'tool_call_start', id: 'tc2', name: 'slow' },
      { type: 'tool_call_delta', id: 'tc2', argsDelta: '{"id":"b"}' },
      { type: 'done' },
    ],
    [{ type: 'text', delta: 'done' }, { type: 'done' }],
  ]
}

function orderTrackingTool(order: string[], delayMs: number) {
  return {
    name: 'slow', description: '', inputSchema: {},
    execute: async (input: { id: string }) => {
      order.push(`start:${input.id}`)
      await new Promise(r => setTimeout(r, delayMs))
      order.push(`end:${input.id}`)
      return `result:${input.id}`
    },
  }
}

function noopToolCall(usage?: { inputTokens: number; outputTokens: number }): StreamChunk[] {
  return [
    { type: 'tool_call_start', id: 'tc1', name: 'noop' },
    { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
    { type: 'done', ...(usage && { usage }) },
  ]
}

function noopTool() {
  const tools = new ToolRegistry()
  tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
  return tools
}

describe('AgentLoop — parallel tool calls', () => {
  it('executes multiple tool calls in parallel by default', async () => {
    const order: string[] = []
    const tools = new ToolRegistry()
    tools.register(orderTrackingTool(order, 50))
    const loop = new AgentLoop({ provider: mockProvider(twoToolCallChunks()), tools, maxIterations: 10 })
    await loop.run([{ role: 'user', content: 'go' }])

    const startA = order.indexOf('start:a')
    const startB = order.indexOf('start:b')
    const endA = order.indexOf('end:a')
    const endB = order.indexOf('end:b')
    // Both starts happen before both ends
    expect(Math.max(startA, startB)).toBeLessThan(Math.min(endA, endB))
  })

  it('executes tool calls sequentially when parallelToolCalls is false', async () => {
    const order: string[] = []
    const tools = new ToolRegistry()
    tools.register(orderTrackingTool(order, 10))
    const loop = new AgentLoop({ provider: mockProvider(twoToolCallChunks()), tools, maxIterations: 10, parallelToolCalls: false })
    await loop.run([{ role: 'user', content: 'go' }])

    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
  })

  it('single tool call produces same result for both parallel settings', async () => {
    for (const parallel of [true, false]) {
      const chunks: StreamChunk[][] = [
        [{ type: 'tool_call_start', id: 'tc1', name: 'echo' }, { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"msg":"hi"}' }, { type: 'done' }],
        [{ type: 'text', delta: 'ok' }, { type: 'done' }],
      ]
      const tools = new ToolRegistry()
      tools.register({ name: 'echo', description: '', inputSchema: {}, execute: async (input: { msg: string }) => input.msg })
      const loop = new AgentLoop({ provider: mockProvider(chunks), tools, maxIterations: 10, parallelToolCalls: parallel })
      const result = await loop.run([{ role: 'user', content: 'go' }])
      expect(result.messages.find(m => m.role === 'tool')?.content).toBe('hi')
    }
  })

  it('one fails, one succeeds — both results returned', async () => {
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
    const result = await new AgentLoop({ provider, tools, maxIterations: 10 }).run([{ role: 'user', content: 'go' }])
    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.find(m => m.content === 'success')?.isError).toBeFalsy()
    expect(toolResults.find(m => m.content === 'fail')?.isError).toBe(true)
  })

  it('respects deny() from middleware', async () => {
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
    tools.register({ name: 'safe', description: '', inputSchema: {}, execute: async () => 'ok' })
    tools.register({ name: 'risky', description: '', inputSchema: {}, execute: async () => 'should not run' })
    const loop = new AgentLoop({
      provider, tools, maxIterations: 10,
      middleware: {
        beforeToolExecution: [async (ctx) => { if (ctx.toolCall.name === 'risky') ctx.deny('Blocked') }],
      },
    })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.find(m => m.toolCallId === 'tc1')?.content).toBe('ok')
    expect(toolResults.find(m => m.toolCallId === 'tc2')?.content).toBe('Blocked')
    expect(toolResults.find(m => m.toolCallId === 'tc2')?.isError).toBe(true)
  })
})

describe('AgentLoop — maxTokenBudget', () => {
  it('stops when token budget is exceeded', async () => {
    const provider = mockProvider(Array(10).fill(noopToolCall({ inputTokens: 500, outputTokens: 500 })))
    const loop = new AgentLoop({ provider, tools: noopTool(), maxIterations: 10, maxTokenBudget: 1500 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    // 1000 tokens/iteration. After 2 = 2000 > 1500. Budget check before iteration 3 catches it.
    expect(result.iterations).toBe(2)
    expect(result.stopReason).toBe('token_budget_exceeded')
  })

  it('does not stop when budget is 0 (unlimited)', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done', usage: { inputTokens: 1000, outputTokens: 1000 } }]])
    const result = await new AgentLoop({ provider, tools: new ToolRegistry(), maxTokenBudget: 0 }).run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })

  it('first iteration always runs even if budget is tiny', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done', usage: { inputTokens: 50, outputTokens: 50 } }]])
    const result = await new AgentLoop({ provider, tools: new ToolRegistry(), maxTokenBudget: 10 }).run([{ role: 'user', content: 'hi' }])
    expect(result.iterations).toBe(1)
  })

  it('stops after multiple iterations when budget accumulates past limit', async () => {
    const provider = mockProvider([
      ...Array(5).fill(noopToolCall({ inputTokens: 100, outputTokens: 100 })),
      [{ type: 'text', delta: 'done' }, { type: 'done', usage: { inputTokens: 50, outputTokens: 50 } }],
    ])
    const loop = new AgentLoop({ provider, tools: noopTool(), maxIterations: 10, maxTokenBudget: 500 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    // 200 tokens/iteration. After 3 = 600 > 500. Budget check before iteration 4 catches it.
    expect(result.iterations).toBe(3)
    expect(result.stopReason).toBe('token_budget_exceeded')
  })
})

describe('AgentLoop — maxDuration', () => {
  it('stops when max duration is exceeded', async () => {
    const provider = mockProvider(Array(20).fill(noopToolCall()))
    const tools = new ToolRegistry()
    tools.register({
      name: 'noop', description: '', inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 50)); return 'ok' },
    })
    const result = await new AgentLoop({ provider, tools, maxIterations: 20, maxDuration: 100 }).run([{ role: 'user', content: 'go' }])

    expect(result.stopReason).toBe('max_duration_exceeded')
    expect(result.iterations).toBeLessThan(20)
  })

  it('does not stop when duration is 0 (unlimited)', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'hello' }, { type: 'done' }]])
    const result = await new AgentLoop({ provider, tools: new ToolRegistry(), maxDuration: 0 }).run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })

  it('completes normally within duration and reports durationMs', async () => {
    const provider = mockProvider([[{ type: 'text', delta: 'fast' }, { type: 'done' }]])
    const result = await new AgentLoop({ provider, tools: new ToolRegistry(), maxDuration: 60000 }).run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.durationMs).toBeLessThan(60000)
  })

  it('durationMs reflects actual execution time', async () => {
    const provider = mockProvider([
      [{ type: 'tool_call_start', id: 'tc1', name: 'slow' }, { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' }, { type: 'done' }],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow', description: '', inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 50)); return 'ok' },
    })
    const result = await new AgentLoop({ provider, tools, maxIterations: 10 }).run([{ role: 'user', content: 'go' }])
    expect(result.durationMs).toBeGreaterThanOrEqual(40)
  })
})
