import { test, expect } from 'bun:test'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { IProvider, ChatRequest, ChatResponse } from '../../src/providers/types'

let callCount = 0

const mockProvider: IProvider = {
  name: 'mock',
  async chat(_req: ChatRequest): Promise<ChatResponse> { return { message: { role: 'assistant', content: 'hello' } } },
  async *stream(_req: ChatRequest) {
    callCount++
    if (callCount === 1) {
      // First call: emit a tool call so the loop continues to a second iteration
      yield { type: 'tool_call_start' as const, id: 'tc1', name: 'noop' }
      yield { type: 'done' as const }
    } else {
      yield { type: 'text' as const, delta: 'hello' }
      yield { type: 'done' as const }
    }
  }
}

test('middleware can stop the loop via ctx.stop()', async () => {
  callCount = 0
  const tools = new ToolRegistry()
  tools.register({ name: 'noop', description: 'no-op', inputSchema: {}, execute: async () => 'ok' })
  let iterations = 0

  const loop = new AgentLoop({
    provider: mockProvider,
    tools,
    model: 'test',
    maxIterations: 5,
    middleware: {
      afterLoopIteration: [
        async (ctx) => {
          iterations++
          if (iterations >= 2) ctx.stop()
        }
      ]
    }
  })

  const result = await loop.run([{ role: 'user', content: 'hi' }])
  expect(result.iterations).toBe(2)
})

test('ctx.stop(reason) includes stopReason in result', async () => {
  callCount = 0
  const tools = new ToolRegistry()
  tools.register({ name: 'noop', description: 'no-op', inputSchema: {}, execute: async () => 'ok' })

  const loop = new AgentLoop({
    provider: mockProvider,
    tools,
    model: 'test',
    maxIterations: 5,
    middleware: {
      beforeModelCall: [async (ctx) => { ctx.stop('token budget exceeded') }]
    }
  })

  const result = await loop.run([{ role: 'user', content: 'hi' }])
  expect(result.stopReason).toBe('token budget exceeded')
  expect(result.iterations).toBe(1)
})

test('stopReason is undefined when stop() called without reason', async () => {
  callCount = 0
  const tools = new ToolRegistry()

  const loop = new AgentLoop({
    provider: mockProvider,
    tools,
    model: 'test',
    middleware: {
      beforeModelCall: [async (ctx) => { ctx.stop() }]
    }
  })

  const result = await loop.run([{ role: 'user', content: 'hi' }])
  expect(result.stopReason).toBeUndefined()
})
