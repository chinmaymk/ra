import { describe, it, expect } from 'bun:test'
import { wrapMcpToolsLazy } from '../../src/mcp/lazy-tools'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { ITool } from '../../src/providers/types'

function makeMcpTool(name: string, description: string, schema: Record<string, unknown>): ITool {
  return {
    name,
    description,
    inputSchema: schema,
    execute: async (input) => ({ called: name, input }),
  }
}

describe('wrapMcpToolsLazy', () => {
  it('registers tools with truncated descriptions', () => {
    const registry = new ToolRegistry()
    const longDesc = 'A'.repeat(200)
    const tools = [makeMcpTool('my_tool', longDesc, { type: 'object', properties: { x: { type: 'string' } } })]

    wrapMcpToolsLazy(registry, tools, { maxDescriptionLength: 50 })

    const registered = registry.get('my_tool')!
    expect(registered.description.length).toBeLessThanOrEqual(50)
    expect(registered.description).toEndWith('...')
  })

  it('keeps short descriptions intact', () => {
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('short_tool', 'Brief desc', { type: 'object' })]

    wrapMcpToolsLazy(registry, tools, { maxDescriptionLength: 100 })

    const registered = registry.get('short_tool')!
    expect(registered.description).toBe('Brief desc')
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
    // Should NOT contain the full properties
    expect(registered.inputSchema.properties).toBeUndefined()
    expect(registered.inputSchema.type).toBe('object')
  })

  it('registers get_mcp_tool_schema meta-tool', () => {
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('my_tool', 'Does things', { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    const metaTool = registry.get('get_mcp_tool_schema')
    expect(metaTool).toBeDefined()
    expect(metaTool!.inputSchema.properties).toBeDefined()
  })

  it('meta-tool returns full schema for known tool', async () => {
    const registry = new ToolRegistry()
    const fullSchema = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    }
    const tools = [makeMcpTool('search', 'Full description of search tool', fullSchema)]

    wrapMcpToolsLazy(registry, tools, { maxDescriptionLength: 20 })

    const metaTool = registry.get('get_mcp_tool_schema')!
    const result = await metaTool.execute({ tool_name: 'search' }) as { name: string; description: string; inputSchema: Record<string, unknown> }

    expect(result.name).toBe('search')
    expect(result.description).toBe('Full description of search tool')
    expect(result.inputSchema).toEqual(fullSchema)
  })

  it('meta-tool returns error for unknown tool', async () => {
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('real_tool', 'desc', { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    const metaTool = registry.get('get_mcp_tool_schema')!
    const result = await metaTool.execute({ tool_name: 'nonexistent' }) as { error: string }

    expect(result.error).toContain('Unknown MCP tool')
    expect(result.error).toContain('real_tool')
  })

  it('preserves execute function on wrapped tools', async () => {
    const registry = new ToolRegistry()
    const tools = [makeMcpTool('my_tool', 'desc', { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('my_tool')!
    const result = await registered.execute({ foo: 'bar' }) as { called: string; input: unknown }
    expect(result.called).toBe('my_tool')
    expect(result.input).toEqual({ foo: 'bar' })
  })

  it('uses default maxDescriptionLength of 100', () => {
    const registry = new ToolRegistry()
    const desc = 'X'.repeat(150)
    const tools = [makeMcpTool('tool1', desc, { type: 'object' })]

    wrapMcpToolsLazy(registry, tools)

    const registered = registry.get('tool1')!
    expect(registered.description.length).toBe(100)
  })

  it('handles multiple tools', () => {
    const registry = new ToolRegistry()
    const tools = [
      makeMcpTool('tool_a', 'First tool', { type: 'object' }),
      makeMcpTool('tool_b', 'Second tool', { type: 'object' }),
      makeMcpTool('tool_c', 'Third tool', { type: 'object' }),
    ]

    wrapMcpToolsLazy(registry, tools)

    expect(registry.get('tool_a')).toBeDefined()
    expect(registry.get('tool_b')).toBeDefined()
    expect(registry.get('tool_c')).toBeDefined()
    expect(registry.get('get_mcp_tool_schema')).toBeDefined()
    // 3 tools + 1 meta-tool
    expect(registry.all()).toHaveLength(4)
  })

  it('meta-tool lists available tools in error message', async () => {
    const registry = new ToolRegistry()
    const tools = [
      makeMcpTool('alpha', 'desc', { type: 'object' }),
      makeMcpTool('beta', 'desc', { type: 'object' }),
    ]

    wrapMcpToolsLazy(registry, tools)

    const metaTool = registry.get('get_mcp_tool_schema')!
    const result = await metaTool.execute({ tool_name: 'missing' }) as { error: string }

    expect(result.error).toContain('alpha')
    expect(result.error).toContain('beta')
  })

  it('does not wrap when no tools provided', () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [])

    // Meta-tool should still be registered even with empty list (harmless)
    expect(registry.get('get_mcp_tool_schema')).toBeDefined()
    expect(registry.all()).toHaveLength(1)
  })
})
