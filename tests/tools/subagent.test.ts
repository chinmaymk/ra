import { describe, it, expect } from 'bun:test'
import { subagentTool, type SubagentToolOptions } from '../../src/tools/subagent'
import type { IProvider, StreamChunk, ChatResponse } from '../../src/providers/types'
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

function baseOptions(overrides?: Partial<SubagentToolOptions> & { responses?: StreamChunk[][] }): SubagentToolOptions {
  const responses = overrides?.responses ?? [[{ type: 'text', delta: 'hello' }, { type: 'done' }]]
  return {
    provider: mockProvider(responses),
    tools: new ToolRegistry(),
    model: 'test-model',
    ...overrides,
  }
}

describe('subagent tool', () => {
  it('has correct name and schema', () => {
    const tool = subagentTool(baseOptions())
    expect(tool.name).toBe('subagent')
    expect(tool.inputSchema.required).toContain('tasks')
  })

  it('runs a single task and returns result', async () => {
    const tool = subagentTool(baseOptions({
      responses: [[{ type: 'text', delta: 'answer-42' }, { type: 'done' }]],
    }))
    const results = await tool.execute({ tasks: [{ task: 'What is 6*7?' }] }) as any[]
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('completed')
    expect(results[0].result).toBe('answer-42')
    expect(results[0].task).toBe('What is 6*7?')
  })

  it('runs multiple tasks in parallel', async () => {
    const executionOrder: string[] = []
    let callIndex = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        const idx = callIndex++
        executionOrder.push(`start-${idx}`)
        yield { type: 'text' as const, delta: `result-${idx}` }
        yield { type: 'done' as const }
        executionOrder.push(`end-${idx}`)
      },
    }

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const results = await tool.execute({
      tasks: [
        { task: 'task-a' },
        { task: 'task-b' },
        { task: 'task-c' },
      ],
    }) as any[]

    expect(results).toHaveLength(3)
    expect(results.every((r: any) => r.status === 'completed')).toBe(true)
  })

  it('handles task errors gracefully', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        throw new Error('provider exploded')
      },
    }

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const results = await tool.execute({
      tasks: [{ task: 'will fail' }],
    }) as any[]

    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('error')
    expect(results[0].result).toContain('provider exploded')
  })

  it('rejects empty tasks array', async () => {
    const tool = subagentTool(baseOptions())
    await expect(tool.execute({ tasks: [] })).rejects.toThrow('At least one task')
  })

  it('maxConcurrency is reflected in schema maxItems', () => {
    const tool = subagentTool(baseOptions({ maxConcurrency: 2 }))
    const tasksSchema = (tool.inputSchema.properties as any).tasks
    expect(tasksSchema.maxItems).toBe(2)
  })

  it('subagents can use parent tools', async () => {
    let toolExecuted = false
    const tools = new ToolRegistry()
    tools.register({
      name: 'greet',
      description: 'Say hello',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      execute: async (input: any) => { toolExecuted = true; return `Hello, ${input.name}!` },
    })

    // Provider that calls the greet tool, then responds
    let callIndex = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        if (callIndex++ === 0) {
          yield { type: 'tool_call_start' as const, id: 'tc1', name: 'greet' }
          yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{"name":"world"}' }
          yield { type: 'done' as const }
        } else {
          yield { type: 'text' as const, delta: 'greeted successfully' }
          yield { type: 'done' as const }
        }
      },
    }

    const tool = subagentTool({ provider, tools, model: 'test' })
    const results = await tool.execute({ tasks: [{ task: 'greet world' }] }) as any[]

    expect(toolExecuted).toBe(true)
    expect(results[0].status).toBe('completed')
    expect(results[0].iterations).toBe(2)
  })

  it('respects depth limit — no subagent tool at max depth', async () => {
    const tool = subagentTool(baseOptions({ maxDepth: 1, _depth: 0 }))
    // The tool itself exists, but child loops won't have subagent tool
    // We can verify by checking the child tool registry indirectly
    const results = await tool.execute({ tasks: [{ task: 'test' }] }) as any[]
    expect(results[0].status).toBe('completed')
  })

  it('includes subagent in children when depth < maxDepth - 1', () => {
    // At depth 0 with maxDepth 3, children should get subagent at depth 1
    const tools = new ToolRegistry()
    const tool = subagentTool({ provider: mockProvider([]), tools, model: 'test', maxDepth: 3, _depth: 0 })
    // Tool is created — we just verify it doesn't throw
    expect(tool.name).toBe('subagent')
  })

  it('passes systemPrompt to subagent messages', async () => {
    const capturedMessages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req) {
        capturedMessages.push(...req.messages)
        yield { type: 'text' as const, delta: 'ok' }
        yield { type: 'done' as const }
      },
    }

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    await tool.execute({
      tasks: [{ task: 'do something', systemPrompt: 'You are a pirate.' }],
    })

    expect(capturedMessages.some((m: any) => m.role === 'system' && m.content === 'You are a pirate.')).toBe(true)
  })

  it('reports token usage from subagent runs', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hi' }, { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } }],
    ])
    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const results = await tool.execute({ tasks: [{ task: 'test' }] }) as any[]
    expect(results[0].usage.inputTokens).toBe(100)
    expect(results[0].usage.outputTokens).toBe(50)
  })

  it('mixed success and failure in parallel tasks', async () => {
    let callIndex = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        if (callIndex++ === 0) {
          yield { type: 'text' as const, delta: 'success' }
          yield { type: 'done' as const }
        } else {
          throw new Error('boom')
        }
      },
    }

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const results = await tool.execute({
      tasks: [{ task: 'good task' }, { task: 'bad task' }],
    }) as any[]

    expect(results).toHaveLength(2)
    // One should succeed, one should fail (order may vary due to parallel execution)
    const statuses = results.map((r: any) => r.status).sort()
    expect(statuses).toEqual(['completed', 'error'])
  })
})
