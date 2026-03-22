import { describe, it, expect } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { StreamChunk } from '@chinmaymk/ra'
import { mockProvider } from './test-utils'

describe('AgentLoop — parallel tool calls', () => {
  it('executes multiple tool calls in parallel by default', async () => {
    const order: string[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'slow' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"id":"a"}' },
        { type: 'tool_call_start', id: 'tc2', name: 'slow' },
        { type: 'tool_call_delta', id: 'tc2', argsDelta: '{"id":"b"}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow', description: '', inputSchema: {},
      execute: async (input: { id: string }) => {
        order.push(`start:${input.id}`)
        await new Promise(r => setTimeout(r, 50))
        order.push(`end:${input.id}`)
        return `result:${input.id}`
      },
    })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    // Both tools should have started before either finished (parallel execution)
    const startA = order.indexOf('start:a')
    const startB = order.indexOf('start:b')
    const endA = order.indexOf('end:a')
    const endB = order.indexOf('end:b')
    expect(startA).toBeLessThan(endA)
    expect(startB).toBeLessThan(endB)
    // Both starts happen before both ends in parallel execution
    expect(Math.max(startA, startB)).toBeLessThan(Math.min(endA, endB))

    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
  })

  it('executes tool calls sequentially when parallelToolCalls is false', async () => {
    const order: string[] = []
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'slow' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"id":"a"}' },
        { type: 'tool_call_start', id: 'tc2', name: 'slow' },
        { type: 'tool_call_delta', id: 'tc2', argsDelta: '{"id":"b"}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow', description: '', inputSchema: {},
      execute: async (input: { id: string }) => {
        order.push(`start:${input.id}`)
        await new Promise(r => setTimeout(r, 10))
        order.push(`end:${input.id}`)
        return `result:${input.id}`
      },
    })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, parallelToolCalls: false })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    // Sequential: first tool finishes before second starts
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])

    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
  })

  it('single tool call works the same regardless of parallelToolCalls setting', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'echo' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"msg":"hi"}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'ok' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'echo', description: '', inputSchema: {}, execute: async (input: { msg: string }) => input.msg })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, parallelToolCalls: true })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResult = result.messages.find(m => m.role === 'tool')
    expect(toolResult?.content).toBe('hi')
  })

  it('parallel execution: one fails, one succeeds — both results returned', async () => {
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
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, parallelToolCalls: true })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    const toolResults = result.messages.filter(m => m.role === 'tool')
    expect(toolResults).toHaveLength(2)
    expect(toolResults.find(m => m.content === 'success')?.isError).toBeFalsy()
    expect(toolResults.find(m => m.content === 'fail')?.isError).toBe(true)
  })

  it('parallel execution respects deny() from middleware', async () => {
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
      parallelToolCalls: true,
      middleware: {
        beforeToolExecution: [async (ctx) => {
          if (ctx.toolCall.name === 'risky') ctx.deny('Blocked')
        }],
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
    const toolCall: StreamChunk[] = [
      { type: 'tool_call_start', id: 'tc1', name: 'noop' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'done', usage: { inputTokens: 500, outputTokens: 500 } },
    ]
    const provider = mockProvider(Array(10).fill(toolCall))
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, maxTokenBudget: 1500 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    // First iteration uses 1000 tokens (under 1500), second uses another 1000 = 2000 (over 1500).
    // Budget check before iteration 3 catches it.
    expect(result.iterations).toBe(2)
    expect(result.stopReason).toBe('token_budget_exceeded')
  })

  it('does not stop when budget is 0 (unlimited)', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hello' }, { type: 'done', usage: { inputTokens: 1000, outputTokens: 1000 } }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, maxTokenBudget: 0 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })

  it('allows exactly one iteration before budget check kicks in', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hello' }, { type: 'done', usage: { inputTokens: 50, outputTokens: 50 } }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, maxTokenBudget: 10 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    // First iteration runs (budget checked before each iteration, starts at 0)
    // No tool calls so loop exits naturally after first iteration
    expect(result.iterations).toBe(1)
    expect(result.stopReason).toBeUndefined() // exited due to no tool calls, not budget
  })

  it('stops after multiple iterations when budget accumulates past limit', async () => {
    const toolCall: StreamChunk[] = [
      { type: 'tool_call_start', id: 'tc1', name: 'noop' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'done', usage: { inputTokens: 100, outputTokens: 100 } },
    ]
    const provider = mockProvider([
      toolCall, toolCall, toolCall, toolCall, toolCall,
      [{ type: 'text', delta: 'done' }, { type: 'done', usage: { inputTokens: 50, outputTokens: 50 } }],
    ])
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: '', inputSchema: {}, execute: async () => 'ok' })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10, maxTokenBudget: 500 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    // Each iteration uses 200 tokens. After 2 = 400, after 3 = 600 > 500.
    // Budget check before iteration 4 catches it.
    expect(result.iterations).toBe(3)
    expect(result.stopReason).toBe('token_budget_exceeded')
  })
})

describe('AgentLoop — maxDuration', () => {
  it('stops when max duration is exceeded', async () => {
    const toolCall: StreamChunk[] = [
      { type: 'tool_call_start', id: 'tc1', name: 'slow' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'done' },
    ]
    const provider = mockProvider(Array(20).fill(toolCall))
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow', description: '', inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 50)); return 'ok' },
    })
    const loop = new AgentLoop({ provider, tools, maxIterations: 20, maxDuration: 100 })
    const result = await loop.run([{ role: 'user', content: 'go' }])

    expect(result.stopReason).toBe('max_duration_exceeded')
    expect(result.iterations).toBeLessThan(20)
  })

  it('does not stop when duration is 0 (unlimited)', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hello' }, { type: 'done' }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, maxDuration: 0 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
  })

  it('completes normally when run finishes within duration', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'fast' }, { type: 'done' }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10, maxDuration: 60000 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.stopReason).toBeUndefined()
    expect(result.durationMs).toBeLessThan(60000)
  })
})

describe('AgentLoop — durationMs in LoopResult', () => {
  it('reports durationMs in result', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hello' }, { type: 'done' }],
    ])
    const loop = new AgentLoop({ provider, tools: new ToolRegistry(), maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'hi' }])
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.durationMs).toBe('number')
  })

  it('durationMs increases with tool execution time', async () => {
    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'slow' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'done' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'done' }],
    ])
    const tools = new ToolRegistry()
    tools.register({
      name: 'slow', description: '', inputSchema: {},
      execute: async () => { await new Promise(r => setTimeout(r, 50)); return 'ok' },
    })
    const loop = new AgentLoop({ provider, tools, maxIterations: 10 })
    const result = await loop.run([{ role: 'user', content: 'go' }])
    expect(result.durationMs).toBeGreaterThanOrEqual(40) // allow some margin
  })
})
