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
})
