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
  it('registers tools with truncated descriptions and server prefix', () => {
    const registry = new ToolRegistry()
    const longDesc = 'A'.repeat(200)
    const tools = [makeMcpTool('my_tool', longDesc, { type: 'object', properties: { x: { type: 'string' } } })]

    wrapMcpToolsLazy(registry, tools, { maxDescriptionLength: 50 })

    const registered = registry.get('my_tool')!
    expect(registered.description.length).toBeLessThanOrEqual(50)
    expect(registered.description).toStartWith('[test-server]')
    expect(registered.description).toEndWith('...')
  })

  it('keeps short descriptions intact with server prefix', () => {
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('short_tool', 'Brief desc', { type: 'object' })]

    wrapMcpToolsLazy(registry, tools, { maxDescriptionLength: 100 })

    const registered = registry.get('short_tool')!
    expect(registered.description).toBe('[test-server] Brief desc')
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

    const registered = registry.get('search')!
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

    const registered = registry.get('search')!
    const result = await registered.execute({}) as { isError: boolean; content: string }

    expect(executed).toBe(false)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Search for things')
    expect(result.content).toContain('"query"')
    expect(result.content).toContain('github')
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

    const registered = registry.get('search')!

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

    const registered = registry.get('my_tool')!

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
    const a1 = await registry.get('tool_a')!.execute({}) as { isError: boolean }
    expect(a1.isError).toBe(true)

    // First call to tool_b — schema (independent)
    const b1 = await registry.get('tool_b')!.execute({}) as { isError: boolean }
    expect(b1.isError).toBe(true)

    // Second call to both — execute
    const a2 = await registry.get('tool_a')!.execute({ x: 1 }) as { called: string }
    expect(a2.called).toBe('tool_a')

    const b2 = await registry.get('tool_b')!.execute({ x: 2 }) as { called: string }
    expect(b2.called).toBe('tool_b')
  })

  it('schema hint includes full description, server name, and parameters', async () => {
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

    const result = await registry.get('read_file')!.execute({}) as { content: string }

    expect(result.content).toContain('read_file')
    expect(result.content).toContain('filesystem')
    expect(result.content).toContain('Read contents of a file from the filesystem')
    expect(result.content).toContain('"path"')
    expect(result.content).toContain('"encoding"')
  })

  it('uses default maxDescriptionLength of 100', () => {
    const registry = new ToolRegistry()
    const desc = 'X'.repeat(150)
    const tools = [makeMcpTool('tool1', desc, { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('tool1')!
    expect(registered.description.length).toBe(100)
  })

  it('handles multiple tools from different servers', () => {
    const registry = new ToolRegistry()
    const tools = [
      makeMcpTool('tool_a', 'First tool', { type: 'object' }, 'github'),
      makeMcpTool('tool_b', 'Second tool', { type: 'object' }, 'github'),
      makeMcpTool('tool_c', 'Third tool', { type: 'object' }, 'database'),
    ]

    wrapMcpToolsLazy(registry, tools)

    expect(registry.get('tool_a')).toBeDefined()
    expect(registry.get('tool_b')).toBeDefined()
    expect(registry.get('tool_c')).toBeDefined()
    expect(registry.all()).toHaveLength(3)

    expect(registry.get('tool_a')!.description).toStartWith('[github]')
    expect(registry.get('tool_c')!.description).toStartWith('[database]')
  })

  it('handles empty tools list', () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [])
    expect(registry.all()).toHaveLength(0)
  })
})
