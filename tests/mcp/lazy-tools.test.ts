import { describe, it, expect } from 'bun:test'
import { wrapMcpToolsLazy, type McpToolEntry } from '../../src/mcp/lazy-tools'
import { ToolRegistry } from '../../src/agent/tool-registry'

function makeMcpTool(
  name: string,
  description: string,
  schema: Record<string, unknown>,
  serverName = 'test-server',
  executeFn?: (input: unknown) => Promise<unknown>,
): McpToolEntry {
  return {
    serverName,
    tool: {
      name,
      description,
      inputSchema: schema,
      execute: executeFn ?? (async (input) => ({ called: name, input })),
    },
  }
}

describe('wrapMcpToolsLazy', () => {
  it('registers tools with server-prefixed names', () => {
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('my_tool', 'Does stuff', { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    expect(registry.get('test-server__my_tool')).toBeDefined()
    expect(registry.get('my_tool')).toBeUndefined()
  })

  it('preserves the original description unchanged', () => {
    const registry = new ToolRegistry()
    const longDesc = 'A'.repeat(200)
    const tools = [makeMcpTool('my_tool', longDesc, { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('test-server__my_tool')!
    expect(registered.description).toBe(longDesc)
  })

  it('registers tools with minimal inputSchema', () => {
    const registry = new ToolRegistry()
    const fullSchema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    }
    const tools = [makeMcpTool('search', 'Search for things', fullSchema)]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('test-server__search')!
    expect(registered.inputSchema.properties).toBeUndefined()
    expect(registered.inputSchema.type).toBe('object')
  })

  it('returns full schema on first call without executing the tool', async () => {
    let executed = false
    const schema = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    }
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('search', 'Search for things', schema, 'github', async (input) => {
      executed = true
      return { results: [] }
    })]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('github__search')!
    const result = await registered.execute({}) as { isError: boolean; content: string }

    expect(executed).toBe(false)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Search for things')
    expect(result.content).toContain('"query"')
    expect(result.content).toContain('github')
    expect(result.content).toContain('github__search')
    expect(result.content).toContain('Retry your call')
  })

  it('executes the real tool on second call', async () => {
    const schema = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    }
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('search', 'Search for things', schema, 'github')]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('github__search')!

    // First call — returns schema
    const first = await registered.execute({}) as { isError: boolean }
    expect(first.isError).toBe(true)

    // Second call — executes normally
    const second = await registered.execute({ query: 'test' }) as { called: string; input: unknown }
    expect(second.called).toBe('search')
    expect(second.input).toEqual({ query: 'test' })
  })

  it('continues executing on all subsequent calls after first', async () => {
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('my_tool', 'desc', { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('test-server__my_tool')!

    // First call — schema
    await registered.execute({})

    // Second, third, fourth calls — all execute
    for (let i = 0; i < 3; i++) {
      const result = await registered.execute({ n: i }) as { called: string; input: unknown }
      expect(result.called).toBe('my_tool')
      expect(result.input).toEqual({ n: i })
    }
  })

  it('each tool tracks its own first-call independently', async () => {
    const registry = new ToolRegistry()
    const tools = [
      makeMcpTool('tool_a', 'Tool A', { type: 'object' }, 'server'),
      makeMcpTool('tool_b', 'Tool B', { type: 'object' }, 'server'),
    ]

    wrapMcpToolsLazy(registry, tools)

    // First call to tool_a — schema
    const a1 = await registry.get('server__tool_a')!.execute({}) as { isError: boolean }
    expect(a1.isError).toBe(true)

    // First call to tool_b — schema (independent)
    const b1 = await registry.get('server__tool_b')!.execute({}) as { isError: boolean }
    expect(b1.isError).toBe(true)

    // Second call to both — execute
    const a2 = await registry.get('server__tool_a')!.execute({ x: 1 }) as { called: string }
    expect(a2.called).toBe('tool_a')

    const b2 = await registry.get('server__tool_b')!.execute({ x: 2 }) as { called: string }
    expect(b2.called).toBe('tool_b')
  })

  it('schema hint includes prefixed name, server name, description, and parameters', async () => {
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        encoding: { type: 'string', description: 'File encoding' },
      },
      required: ['path'],
    }
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('read_file', 'Read contents of a file from the filesystem', schema, 'filesystem')]

    wrapMcpToolsLazy(registry, tools)

    const result = await registry.get('filesystem__read_file')!.execute({}) as { content: string }

    expect(result.content).toContain('filesystem__read_file')
    expect(result.content).toContain('filesystem')
    expect(result.content).toContain('Read contents of a file from the filesystem')
    expect(result.content).toContain('"path"')
    expect(result.content).toContain('"encoding"')
  })

  it('same tool name from different servers does not conflict', () => {
    const registry = new ToolRegistry()
    const tools = [
      makeMcpTool('search', 'GitHub search', { type: 'object' }, 'github'),
      makeMcpTool('search', 'Database search', { type: 'object' }, 'database'),
    ]

    wrapMcpToolsLazy(registry, tools)

    expect(registry.get('github__search')).toBeDefined()
    expect(registry.get('database__search')).toBeDefined()
    expect(registry.get('github__search')!.description).toBe('GitHub search')
    expect(registry.get('database__search')!.description).toBe('Database search')
  })

  it('handles multiple tools from different servers', () => {
    const registry = new ToolRegistry()
    const tools = [
      makeMcpTool('tool_a', 'First tool', { type: 'object' }, 'github'),
      makeMcpTool('tool_b', 'Second tool', { type: 'object' }, 'github'),
      makeMcpTool('tool_c', 'Third tool', { type: 'object' }, 'database'),
    ]

    wrapMcpToolsLazy(registry, tools)

    expect(registry.get('github__tool_a')).toBeDefined()
    expect(registry.get('github__tool_b')).toBeDefined()
    expect(registry.get('database__tool_c')).toBeDefined()
    expect(registry.all()).toHaveLength(3)
  })

  it('handles empty tools list', () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [])
    expect(registry.all()).toHaveLength(0)
  })
})
