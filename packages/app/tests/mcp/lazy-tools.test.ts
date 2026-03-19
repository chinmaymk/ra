import { describe, it, expect } from 'bun:test'
import { wrapMcpToolsLazy, prefixToolName, type McpToolEntry } from '../../src/mcp/lazy-tools'
import { ToolRegistry } from '@chinmaymk/ra'

function makeMcpTool(
  name: string,
  description: string,
  schema: Record<string, unknown>,
  serverName = 'test_server',
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

describe('prefixToolName', () => {
  it('prefixes tool name with server name', () => {
    expect(prefixToolName('github', 'search')).toBe('github__search')
  })

  it('sanitizes non-alphanumeric characters in server name', () => {
    expect(prefixToolName('my-server', 'tool')).toBe('my_server__tool')
    expect(prefixToolName('my.server.v2', 'tool')).toBe('my_server_v2__tool')
    expect(prefixToolName('server@host:8080', 'tool')).toBe('server_host_8080__tool')
  })
})

describe('wrapMcpToolsLazy', () => {
  it('registers tools with server-prefixed names', () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [makeMcpTool('my_tool', 'Does stuff', { type: 'object' })])

    expect(registry.get('test_server__my_tool')).toBeDefined()
    expect(registry.get('my_tool')).toBeUndefined()
  })

  it('preserves the original description unchanged', () => {
    const registry = new ToolRegistry()
    const longDesc = 'A'.repeat(200)
    wrapMcpToolsLazy(registry, [makeMcpTool('my_tool', longDesc, { type: 'object' })])

    expect(registry.get('test_server__my_tool')!.description).toBe(longDesc)
  })

  it('registers tools with minimal inputSchema', () => {
    const registry = new ToolRegistry()
    const fullSchema = {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    }
    wrapMcpToolsLazy(registry, [makeMcpTool('search', 'Search', fullSchema)])

    const registered = registry.get('test_server__search')!
    expect(registered.inputSchema.properties).toBeUndefined()
    expect(registered.inputSchema.type).toBe('object')
  })

  it('returns full schema on first call without executing', async () => {
    let executed = false
    const schema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [makeMcpTool('search', 'Search for things', schema, 'github', async () => {
      executed = true
      return { results: [] }
    })])

    const result = await registry.get('github__search')!.execute({}) as { isError: boolean; content: string }

    expect(executed).toBe(false)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Search for things')
    expect(result.content).toContain('"query"')
    expect(result.content).toContain('github')
    expect(result.content).toContain('github__search')
    expect(result.content).toContain('Retry')
  })

  it('executes the real tool on second call', async () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [makeMcpTool('search', 'Search', { type: 'object' }, 'github')])

    const registered = registry.get('github__search')!
    const first = await registered.execute({}) as { isError: boolean }
    expect(first.isError).toBe(true)

    const second = await registered.execute({ query: 'test' }) as { called: string; input: unknown }
    expect(second.called).toBe('search')
    expect(second.input).toEqual({ query: 'test' })
  })

  it('continues executing on all subsequent calls', async () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [makeMcpTool('my_tool', 'desc', { type: 'object' })])

    const registered = registry.get('test_server__my_tool')!
    await registered.execute({}) // first call — schema

    for (let i = 0; i < 3; i++) {
      const result = await registered.execute({ n: i }) as { called: string; input: unknown }
      expect(result.called).toBe('my_tool')
      expect(result.input).toEqual({ n: i })
    }
  })

  it('each tool tracks first-call independently', async () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [
      makeMcpTool('tool_a', 'Tool A', { type: 'object' }, 'server'),
      makeMcpTool('tool_b', 'Tool B', { type: 'object' }, 'server'),
    ])

    const a1 = await registry.get('server__tool_a')!.execute({}) as { isError: boolean }
    const b1 = await registry.get('server__tool_b')!.execute({}) as { isError: boolean }
    expect(a1.isError).toBe(true)
    expect(b1.isError).toBe(true)

    const a2 = await registry.get('server__tool_a')!.execute({ x: 1 }) as { called: string }
    const b2 = await registry.get('server__tool_b')!.execute({ x: 2 }) as { called: string }
    expect(a2.called).toBe('tool_a')
    expect(b2.called).toBe('tool_b')
  })

  it('same tool name from different servers does not conflict', () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [
      makeMcpTool('search', 'GitHub search', { type: 'object' }, 'github'),
      makeMcpTool('search', 'Database search', { type: 'object' }, 'database'),
    ])

    expect(registry.get('github__search')!.description).toBe('GitHub search')
    expect(registry.get('database__search')!.description).toBe('Database search')
  })

  it('sanitizes server names with special characters', () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [makeMcpTool('tool', 'desc', { type: 'object' }, 'my-server')])

    expect(registry.get('my_server__tool')).toBeDefined()
  })

  it('handles multiple tools from different servers', () => {
    const registry = new ToolRegistry()
    wrapMcpToolsLazy(registry, [
      makeMcpTool('tool_a', 'First', { type: 'object' }, 'github'),
      makeMcpTool('tool_b', 'Second', { type: 'object' }, 'github'),
      makeMcpTool('tool_c', 'Third', { type: 'object' }, 'database'),
    ])

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
