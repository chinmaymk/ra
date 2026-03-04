import { test, expect } from 'bun:test'
import { loadMiddleware } from '../../src/middleware/loader'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import { defaultConfig } from '../../src/config/defaults'
import type { IProvider, ChatRequest } from '../../src/providers/types'

const mockProvider: IProvider = {
  name: 'mock',
  async chat(_req: ChatRequest) { return { message: { role: 'assistant' as const, content: 'ok' } } },
  async *stream(_req: ChatRequest) {
    yield { type: 'text' as const, delta: 'ok' }
    yield { type: 'done' as const }
  }
}

test('inline middleware is called during loop run', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeLoopBegin: [`async (ctx) => { globalThis.__mwE2eTest = 'hit' }`],
    },
  }
  const mw = await loadMiddleware(config, process.cwd())
  const loop = new AgentLoop({
    provider: mockProvider,
    tools: new ToolRegistry(),
    model: 'test',
    middleware: mw,
  })
  await loop.run([{ role: 'user', content: 'hello' }])
  expect((globalThis as Record<string, unknown>).__mwE2eTest).toBe('hit')
})

test('inline middleware ctx.stop() halts the loop', async () => {
  const config = {
    ...defaultConfig,
    middleware: {
      beforeModelCall: [`async (ctx) => { ctx.stop() }`],
    },
  }
  const mw = await loadMiddleware(config, process.cwd())
  const loop = new AgentLoop({
    provider: mockProvider,
    tools: new ToolRegistry(),
    model: 'test',
    maxIterations: 10,
    middleware: mw,
  })
  const result = await loop.run([{ role: 'user', content: 'hello' }])
  // Loop stopped before model call on iteration 1
  expect(result.iterations).toBe(1)
  // No assistant message was appended (model was never called)
  expect(result.messages.filter(m => m.role === 'assistant')).toHaveLength(0)
})
