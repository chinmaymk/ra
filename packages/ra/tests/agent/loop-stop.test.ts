import { test, expect } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import { mockProvider } from './test-utils'

test('middleware can stop the loop via ctx.stop()', async () => {
  const provider = mockProvider([
    [
      { type: 'tool_call_start', id: 'tc1', name: 'noop' },
      { type: 'done' },
    ],
    [{ type: 'text', delta: 'hello' }, { type: 'done' }],
  ])
  const tools = new ToolRegistry()
  tools.register({ name: 'noop', description: 'no-op', inputSchema: {}, execute: async () => 'ok' })
  let iterations = 0

  const loop = new AgentLoop({
    provider,
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
  const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
  const loop = new AgentLoop({
    provider,
    tools: new ToolRegistry(),
    model: 'test',
    middleware: {
      beforeModelCall: [async (ctx) => { ctx.stop('token budget exceeded', { immediate: true }) }]
    }
  })

  const result = await loop.run([{ role: 'user', content: 'hi' }])
  expect(result.stopReason).toBe('token budget exceeded')
  expect(result.iterations).toBe(1)
})

test('stopReason is undefined when stop() called without reason', async () => {
  const provider = mockProvider([[{ type: 'text', delta: 'hi' }, { type: 'done' }]])
  const loop = new AgentLoop({
    provider,
    tools: new ToolRegistry(),
    model: 'test',
    middleware: {
      beforeModelCall: [async (ctx) => { ctx.stop(undefined, { immediate: true }) }]
    }
  })

  const result = await loop.run([{ role: 'user', content: 'hi' }])
  expect(result.stopReason).toBeUndefined()
})
