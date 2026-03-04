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

  it('throws when stdio config is missing command', async () => {
    const client = new McpClient()
    const registry = new ToolRegistry()
    const config = [{ name: 'test', transport: 'stdio' as const }]
    await expect(client.connect(config, registry)).rejects.toThrow('requires a command')
  })

  it('throws when sse config is missing url', async () => {
    const client = new McpClient()
    const registry = new ToolRegistry()
    const config = [{ name: 'test', transport: 'sse' as const }]
    await expect(client.connect(config, registry)).rejects.toThrow('requires a url')
  })

  it('disconnect on fresh client does not throw', async () => {
    const client = new McpClient()
    await client.disconnect()
    // No error means success
  })

  it('disconnect does not throw when client.close() rejects', async () => {
    const client = new McpClient()
    ;(client as any).clients = [
      { close: async () => { throw new Error('close failed') } },
      { close: async () => {} },
    ]
    await expect(client.disconnect()).resolves.toBeUndefined()
    expect((client as any).clients).toEqual([])
  })

  it('connects to stdio transport, registers tools, and disconnects', async () => {
    // Write a minimal MCP server script that exposes one tool
    const { mkdirSync, writeFileSync, rmSync } = await import('fs')
    const dir = '/tmp/ra-mcp-client-test'
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}/server.ts`, `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
const server = new McpServer({ name: 'test-server', version: '1.0.0' })
server.tool('greet', 'Say hello', { name: z.string() }, async ({ name }) => ({
  content: [{ type: 'text' as const, text: 'Hello ' + name }],
}))
server.connect(new StdioServerTransport())
`)

    const mcpClient = new McpClient()
    const registry = new ToolRegistry()

    try {
      await mcpClient.connect([{
        name: 'test-stdio-server',
        transport: 'stdio' as const,
        command: 'bun',
        args: ['run', `${dir}/server.ts`],
      }], registry)

      const tools = registry.all()
      expect(tools.length).toBeGreaterThanOrEqual(1)
      expect(tools.some(t => t.name === 'greet')).toBe(true)

      // Execute the registered tool
      const tool = tools.find(t => t.name === 'greet')!
      const result = await tool.execute({ name: 'World' }) as any
      expect(result.content[0].text).toBe('Hello World')

      await mcpClient.disconnect()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
