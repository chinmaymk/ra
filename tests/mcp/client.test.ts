import { describe, it, expect } from 'bun:test'
import { McpClient } from '../../src/mcp/client'
import { ToolRegistry } from '../../src/agent/tool-registry'

describe('McpClient', () => {
  it('creates instance', () => {
    const client = new McpClient()
    expect(client).toBeDefined()
    expect(typeof client.connect).toBe('function')
    expect(typeof client.disconnect).toBe('function')
  })

  it('connect accepts empty config array without error', async () => {
    const client = new McpClient()
    const registry = new ToolRegistry()
    await client.connect([], registry)
    expect(registry.all()).toHaveLength(0)
  })
})
