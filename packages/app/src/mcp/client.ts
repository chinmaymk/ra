import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { ToolRegistry, Logger } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'
import type { McpClientConfig } from '../config/types'
import { wrapMcpToolsLazy, prefixToolName, type McpToolEntry } from './lazy-tools'

export interface McpConnectOptions {
  lazySchemas?: boolean
  logger?: Logger
}

export class McpClient {
  private clients: Client[]

  constructor(clients: Client[] = []) {
    this.clients = clients
  }

  async connect(configs: McpClientConfig[], registry: ToolRegistry, options?: McpConnectOptions): Promise<void> {
    const logger = options?.logger ?? new NoopLogger()

    try {
      const mcpTools: McpToolEntry[] = []

      for (const config of configs) {
        if (config.transport === 'stdio' && !config.command) throw new Error(`McpClientConfig "${config.name}" requires a command for stdio transport`)
        if (config.transport === 'sse' && !config.url) throw new Error(`McpClientConfig "${config.name}" requires a url for sse transport`)

        logger.debug('connecting to MCP server', { server: config.name, transport: config.transport })

        const transport = config.transport === 'stdio'
          ? new StdioClientTransport({ command: config.command as string, args: config.args, env: config.env, cwd: config.cwd })
          : new SSEClientTransport(new URL(config.url as string))

        const client = new Client({ name: config.name, version: '1.0.0' })
        await client.connect(transport)
        this.clients.push(client)

        const { tools } = await client.listTools()
        logger.info('MCP server connected', { server: config.name, toolCount: tools.length, tools: tools.map(t => t.name) })

        for (const tool of tools) {
          mcpTools.push({
            serverName: config.name,
            tool: {
              name: tool.name,
              description: tool.description ?? '',
              inputSchema: tool.inputSchema as Record<string, unknown>,
              execute: (input) => client.callTool({ name: tool.name, arguments: input as Record<string, unknown> }),
            },
          })
        }
      }

      if (options?.lazySchemas && mcpTools.length > 0) {
        logger.debug('registering MCP tools with lazy schemas', { toolCount: mcpTools.length })
        wrapMcpToolsLazy(registry, mcpTools)
      } else {
        for (const { tool, serverName } of mcpTools) {
          registry.register({ ...tool, name: prefixToolName(serverName, tool.name) })
        }
        logger.debug('mcp tools registered', { toolCount: mcpTools.length })
      }
    } catch (err) {
      logger.error('MCP connection failed, cleaning up', { error: err instanceof Error ? err.message : String(err) })
      // Clean up already-connected clients to avoid leaked child processes
      await this.disconnect()
      throw err
    }
  }

  async disconnect(): Promise<void> {
    await Promise.allSettled(this.clients.map(c => c.close()))
    this.clients = []
  }
}
