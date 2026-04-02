import { test, expect } from 'bun:test'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { IProvider, ChatRequest } from '@chinmaymk/ra'
import { loadCustomTools } from '../../src/tools/loader'
import path from 'path'

const fixturesDir = path.join(import.meta.dir, 'fixtures')

/**
 * Mock provider that returns a tool call on the first iteration,
 * then a text response on the second.
 */
function toolCallingProvider(toolName: string, toolArgs: Record<string, unknown>): IProvider {
  let callCount = 0
  return {
    name: 'mock',
    async chat() { return { message: { role: 'assistant', content: 'ok' } } },
    async *stream(_req: ChatRequest) {
      callCount++
      if (callCount === 1) {
        yield { type: 'tool_call_start', id: 'tc1', name: toolName }
        yield { type: 'tool_call_delta', id: 'tc1', argsDelta: JSON.stringify(toolArgs) }
        yield { type: 'done' }
      } else {
        yield { type: 'text', delta: 'done' }
        yield { type: 'done' }
      }
    },
  }
}

test('shell script tool executes through AgentLoop', async () => {
  const tools = new ToolRegistry()
  const loaded = await loadCustomTools(['./echo-tool.sh'], fixturesDir)
  for (const t of loaded) tools.register(t)

  const provider = toolCallingProvider('EchoTool', { message: 'world' })
  const loop = new AgentLoop({
    provider,
    tools,
    model: 'test',
    maxIterations: 5,
  })

  const result = await loop.run([{ role: 'user', content: 'test' }])

  expect(result.iterations).toBe(2)
  const toolResult = result.messages.find(m => m.role === 'tool')
  expect(toolResult).toBeDefined()
  expect(toolResult!.content).toContain('echo: world')
})

test('shell script tool with inputSchema executes through AgentLoop', async () => {
  const tools = new ToolRegistry()
  const loaded = await loadCustomTools(['./add-tool.sh'], fixturesDir)
  for (const t of loaded) tools.register(t)

  const provider = toolCallingProvider('AddTool', { a: 7, b: 3 })
  const loop = new AgentLoop({
    provider,
    tools,
    model: 'test',
    maxIterations: 5,
  })

  const result = await loop.run([{ role: 'user', content: 'add' }])

  expect(result.iterations).toBe(2)
  const toolResult = result.messages.find(m => m.role === 'tool')
  expect(toolResult).toBeDefined()
  expect(toolResult!.content).toContain('10')
})

test('shell script tool error becomes error tool result', async () => {
  const tools = new ToolRegistry()
  const loaded = await loadCustomTools(['./failing-tool.sh'], fixturesDir)
  for (const t of loaded) tools.register(t)

  const provider = toolCallingProvider('FailingTool', {})
  const loop = new AgentLoop({
    provider,
    tools,
    model: 'test',
    maxIterations: 5,
  })

  const result = await loop.run([{ role: 'user', content: 'fail' }])

  expect(result.iterations).toBe(2)
  const toolResult = result.messages.find(m => m.role === 'tool')
  expect(toolResult).toBeDefined()
  expect(toolResult!.isError).toBe(true)
  expect(toolResult!.content).toContain('exited with code 1')
})

test('shell tool and TS tool coexist in same registry', async () => {
  const tools = new ToolRegistry()
  const loaded = await loadCustomTools(['./echo-tool.sh', './object-tool.ts'], fixturesDir)
  for (const t of loaded) tools.register(t)

  expect(tools.all().map(t => t.name).sort()).toEqual(['EchoTool', 'ObjectTool'])

  // Both execute correctly
  const echoResult = await tools.execute('EchoTool', { message: 'hi' })
  expect(echoResult).toContain('echo: hi')

  const objResult = await tools.execute('ObjectTool', { message: 'hi' })
  expect(objResult).toBe('echo: hi')
})
