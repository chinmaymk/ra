import { describe, it, expect } from 'bun:test'
import { subagentTool, type SubagentToolOptions } from '../../src/tools/subagent'
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
  // ── Basic functionality ──────────────────────────────────────────

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
    let callIndex = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        const idx = callIndex++
        yield { type: 'text' as const, delta: `result-${idx}` }
        yield { type: 'done' as const }
      },
    }

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const results = await tool.execute({
      tasks: [{ task: 'task-a' }, { task: 'task-b' }, { task: 'task-c' }],
    }) as any[]

    expect(results).toHaveLength(3)
    expect(results.every((r: any) => r.status === 'completed')).toBe(true)
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
    expect(capturedMessages.some((m: any) => m.role === 'user' && m.content === 'do something')).toBe(true)
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

  it('maxConcurrency is reflected in schema maxItems', () => {
    const tool = subagentTool(baseOptions({ maxConcurrency: 2 }))
    const tasksSchema = (tool.inputSchema.properties as any).tasks
    expect(tasksSchema.maxItems).toBe(2)
  })

  // ── Error handling ───────────────────────────────────────────────

  it('handles task errors gracefully without affecting siblings', async () => {
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
    const statuses = results.map((r: any) => r.status).sort()
    expect(statuses).toEqual(['completed', 'error'])
  })

  it('rejects empty tasks array', async () => {
    const tool = subagentTool(baseOptions())
    await expect(tool.execute({ tasks: [] })).rejects.toThrow('At least one task')
  })

  it('rejects undefined tasks', async () => {
    const tool = subagentTool(baseOptions())
    await expect(tool.execute({})).rejects.toThrow('At least one task')
  })

  it('returns empty string when model produces empty assistant message', async () => {
    // The loop always pushes an assistant message even with empty text
    const provider = mockProvider([[{ type: 'done' as const }]])
    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const results = await tool.execute({ tasks: [{ task: 'silent' }] }) as any[]
    expect(results[0].status).toBe('completed')
    expect(results[0].result).toBe('')
  })

  // ── Tool isolation (bug fixes) ──────────────────────────────────

  it('subagents can use parent tools', async () => {
    let toolExecuted = false
    const tools = new ToolRegistry()
    tools.register({
      name: 'greet',
      description: 'Say hello',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      execute: async (input: any) => { toolExecuted = true; return `Hello, ${input.name}!` },
    })

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

  it('excludes ask_user from subagent child tools', async () => {
    const capturedTools: string[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        for (const t of req.tools ?? []) capturedTools.push(t.name)
        yield { type: 'text' as const, delta: 'ok' }
        yield { type: 'done' as const }
      },
    }

    const tools = new ToolRegistry()
    tools.register({ name: 'ask_user', description: 'ask', inputSchema: {}, execute: async () => 'answer' })
    tools.register({ name: 'read_file', description: 'read', inputSchema: {}, execute: async () => 'content' })

    const tool = subagentTool({ provider, tools, model: 'test' })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools).toContain('read_file')
    expect(capturedTools).not.toContain('ask_user')
    // subagent IS present at depth 0 (since depth+1 < maxDepth=2)
    expect(capturedTools).toContain('subagent')
  })

  it('picks up tools registered after construction (lazy registry)', async () => {
    const capturedTools: string[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        for (const t of req.tools ?? []) capturedTools.push(t.name)
        yield { type: 'text' as const, delta: 'ok' }
        yield { type: 'done' as const }
      },
    }

    const tools = new ToolRegistry()
    tools.register({ name: 'tool_a', description: 'a', inputSchema: {}, execute: async () => 'a' })

    // Create subagent BEFORE tool_b is registered
    const tool = subagentTool({ provider, tools, model: 'test' })

    // Register tool_b AFTER subagent construction
    tools.register({ name: 'tool_b', description: 'b', inputSchema: {}, execute: async () => 'b' })

    await tool.execute({ tasks: [{ task: 'test' }] })

    // Both tools should be available because registry is built lazily
    expect(capturedTools).toContain('tool_a')
    expect(capturedTools).toContain('tool_b')
  })

  // ── Depth limiting ───────────────────────────────────────────────

  it('children at max depth do not have subagent tool', async () => {
    const capturedTools: string[][] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        capturedTools.push((req.tools ?? []).map(t => t.name))
        yield { type: 'text' as const, delta: 'ok' }
        yield { type: 'done' as const }
      },
    }

    // depth=0, maxDepth=1 → children should NOT get subagent
    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test', maxDepth: 1, _depth: 0 })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools[0]).not.toContain('subagent')
  })

  it('children below max depth DO have subagent tool', async () => {
    const capturedTools: string[][] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        capturedTools.push((req.tools ?? []).map(t => t.name))
        yield { type: 'text' as const, delta: 'ok' }
        yield { type: 'done' as const }
      },
    }

    // depth=0, maxDepth=3 → children at depth 1 should still get subagent
    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test', maxDepth: 3, _depth: 0 })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools[0]).toContain('subagent')
  })

  // ── maxIterations ────────────────────────────────────────────────

  it('respects maxIterations per subagent', async () => {
    const infiniteToolCall: StreamChunk[] = [
      { type: 'tool_call_start', id: 'tc1', name: 'noop' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'tool_call_end', id: 'tc1' },
      { type: 'done' },
    ]
    const tools = new ToolRegistry()
    tools.register({ name: 'noop', description: 'noop', inputSchema: {}, execute: async () => 'ok' })
    const provider = mockProvider(Array(100).fill(infiniteToolCall))

    const tool = subagentTool({ provider, tools, model: 'test', maxIterations: 3 })
    const results = await tool.execute({ tasks: [{ task: 'loop forever' }] }) as any[]

    expect(results[0].status).toBe('completed')
    expect(results[0].iterations).toBeLessThanOrEqual(3)
  })
})
