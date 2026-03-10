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

/** Mock provider that calls onStream for each request, then yields 'ok' */
function capturingProvider(onStream: (req: ChatRequest) => void): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream(req: ChatRequest) {
      onStream(req)
      yield { type: 'text' as const, delta: 'ok' }
      yield { type: 'done' as const }
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
    const out = await tool.execute({ tasks: [{ task: 'What is 6*7?' }] }) as any
    expect(out.results).toHaveLength(1)
    expect(out.results[0].status).toBe('completed')
    expect(out.results[0].result).toBe('answer-42')
    expect(out.results[0].task).toBe('What is 6*7?')
  })

  it('runs multiple tasks in parallel', async () => {
    const provider = capturingProvider(() => {})
    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const out = await tool.execute({
      tasks: [{ task: 'task-a' }, { task: 'task-b' }, { task: 'task-c' }],
    }) as any

    expect(out.results).toHaveLength(3)
    expect(out.results.every((r: any) => r.status === 'completed')).toBe(true)
  })

  // ── Fork model: inherits parent config ─────────────────────────

  it('inherits parent system prompt', async () => {
    const capturedMessages: any[] = []
    const provider = capturingProvider(req => capturedMessages.push(...req.messages))

    const tool = subagentTool({
      provider, tools: new ToolRegistry(), model: 'test',
      systemPrompt: 'You are a coding assistant.',
    })
    await tool.execute({ tasks: [{ task: 'do something' }] })

    expect(capturedMessages.some((m: any) => m.role === 'system' && m.content === 'You are a coding assistant.')).toBe(true)
    expect(capturedMessages.some((m: any) => m.role === 'user' && m.content === 'do something')).toBe(true)
  })

  it('no system message when parent has none', async () => {
    const capturedMessages: any[] = []
    const provider = capturingProvider(req => capturedMessages.push(...req.messages))

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    await tool.execute({ tasks: [{ task: 'do something' }] })

    expect(capturedMessages.some((m: any) => m.role === 'system')).toBe(false)
  })

  it('inherits parent model', async () => {
    let capturedModel = ''
    const provider = capturingProvider(req => { capturedModel = req.model })

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'parent-model' })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedModel).toBe('parent-model')
  })

  it('inherits parent thinking level', async () => {
    let capturedThinking: any = undefined
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream(req: ChatRequest) {
        capturedThinking = req.thinking
        yield { type: 'text' as const, delta: 'ok' }
        yield { type: 'done' as const }
      },
    }

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test', thinking: 'high' })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedThinking).toBeDefined()
  })

  // ── Token usage ────────────────────────────────────────────────

  it('reports token usage from subagent runs', async () => {
    const provider = mockProvider([
      [{ type: 'text', delta: 'hi' }, { type: 'done', usage: { inputTokens: 100, outputTokens: 50 } }],
    ])
    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const out = await tool.execute({ tasks: [{ task: 'test' }] }) as any
    expect(out.results[0].usage.inputTokens).toBe(100)
    expect(out.results[0].usage.outputTokens).toBe(50)
  })

  it('returns aggregate usage across all tasks', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('use stream') },
      async *stream() {
        yield { type: 'text' as const, delta: 'ok' }
        yield { type: 'done' as const, usage: { inputTokens: 100, outputTokens: 50 } }
      },
    }

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const out = await tool.execute({
      tasks: [{ task: 'a' }, { task: 'b' }, { task: 'c' }],
    }) as any

    expect(out.usage.inputTokens).toBe(300)
    expect(out.usage.outputTokens).toBe(150)
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
    const out = await tool.execute({
      tasks: [{ task: 'good task' }, { task: 'bad task' }],
    }) as any

    expect(out.results).toHaveLength(2)
    const statuses = out.results.map((r: any) => r.status).sort()
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
    const provider = mockProvider([[{ type: 'done' as const }]])
    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test' })
    const out = await tool.execute({ tasks: [{ task: 'silent' }] }) as any
    expect(out.results[0].status).toBe('completed')
    expect(out.results[0].result).toBe('')
  })

  // ── Tool inheritance ──────────────────────────────────────────

  it('forks inherit parent tools', async () => {
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
    const out = await tool.execute({ tasks: [{ task: 'greet world' }] }) as any

    expect(toolExecuted).toBe(true)
    expect(out.results[0].status).toBe('completed')
    expect(out.results[0].iterations).toBe(2)
  })

  it('excludes ask_user from forks', async () => {
    const capturedTools: string[] = []
    const provider = capturingProvider(req => {
      for (const t of req.tools ?? []) capturedTools.push(t.name)
    })

    const tools = new ToolRegistry()
    tools.register({ name: 'ask_user', description: 'ask', inputSchema: {}, execute: async () => 'answer' })
    tools.register({ name: 'read_file', description: 'read', inputSchema: {}, execute: async () => 'content' })

    const tool = subagentTool({ provider, tools, model: 'test' })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools).toContain('read_file')
    expect(capturedTools).not.toContain('ask_user')
    expect(capturedTools).toContain('subagent')
  })

  it('forks inherit memory tools', async () => {
    const capturedTools: string[] = []
    const provider = capturingProvider(req => {
      for (const t of req.tools ?? []) capturedTools.push(t.name)
    })

    const tools = new ToolRegistry()
    tools.register({ name: 'memory_save', description: 'save', inputSchema: {}, execute: async () => 'ok' })
    tools.register({ name: 'memory_search', description: 'search', inputSchema: {}, execute: async () => '[]' })
    tools.register({ name: 'memory_forget', description: 'forget', inputSchema: {}, execute: async () => '0' })
    tools.register({ name: 'read_file', description: 'read', inputSchema: {}, execute: async () => 'content' })

    const tool = subagentTool({ provider, tools, model: 'test' })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools).toContain('read_file')
    expect(capturedTools).toContain('memory_save')
    expect(capturedTools).toContain('memory_search')
    expect(capturedTools).toContain('memory_forget')
  })

  it('picks up tools registered after construction (lazy registry)', async () => {
    const capturedTools: string[] = []
    const provider = capturingProvider(req => {
      for (const t of req.tools ?? []) capturedTools.push(t.name)
    })

    const tools = new ToolRegistry()
    tools.register({ name: 'tool_a', description: 'a', inputSchema: {}, execute: async () => 'a' })

    const tool = subagentTool({ provider, tools, model: 'test' })

    // Register tool_b AFTER subagent construction
    tools.register({ name: 'tool_b', description: 'b', inputSchema: {}, execute: async () => 'b' })

    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools).toContain('tool_a')
    expect(capturedTools).toContain('tool_b')
  })

  // ── Depth limiting ───────────────────────────────────────────────

  it('children at max depth do not have subagent tool', async () => {
    const capturedTools: string[][] = []
    const provider = capturingProvider(req => {
      capturedTools.push((req.tools ?? []).map(t => t.name))
    })

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test', maxDepth: 1, _depth: 0 })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools[0]).not.toContain('subagent')
  })

  it('children below max depth DO have subagent tool', async () => {
    const capturedTools: string[][] = []
    const provider = capturingProvider(req => {
      capturedTools.push((req.tools ?? []).map(t => t.name))
    })

    const tool = subagentTool({ provider, tools: new ToolRegistry(), model: 'test', maxDepth: 3, _depth: 0 })
    await tool.execute({ tasks: [{ task: 'test' }] })

    expect(capturedTools[0]).toContain('subagent')
  })

  // ── maxIterations ─────────────────────────────────────────────────

  it('respects maxIterations per fork', async () => {
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
    const out = await tool.execute({ tasks: [{ task: 'loop forever' }] }) as any

    expect(out.results[0].status).toBe('completed')
    expect(out.results[0].iterations).toBeLessThanOrEqual(3)
  })
})
