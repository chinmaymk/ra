import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { ToolRegistry } from '../agent/tool-registry'
import type { McpClientConfig } from '../config/types'

export class McpClient {
  private clients: Client[] = []

  async connect(configs: McpClientConfig[], registry: ToolRegistry): Promise<void> {
    for (const config of configs) {
      if (config.transport === 'stdio' && !config.command) throw new Error(`McpClientConfig "${config.name}" requires a command for stdio transport`)
      if (config.transport === 'sse' && !config.url) throw new Error(`McpClientConfig "${config.name}" requires a url for sse transport`)

      const transport = config.transport === 'stdio'
        ? new StdioClientTransport({ command: config.command!, args: config.args })
        : new SSEClientTransport(new URL(config.url!))

      const client = new Client({ name: config.name, version: '1.0.0' })
      await client.connect(transport)
      this.clients.push(client)

      const { tools } = await client.listTools()
      for (const tool of tools) {
        registry.register({
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: tool.inputSchema as Record<string, unknown>,
          execute: (input) => client.callTool({ name: tool.name, arguments: input as Record<string, unknown> }),
        })
      }
    }
  }

  async disconnect(): Promise<void> {
    await Promise.all(this.clients.map(c => c.close()))
    this.clients = []
  }
}
