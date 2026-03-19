import type { ITool, ToolRegistry } from '@chinmaymk/ra'

export interface McpToolEntry {
  tool: ITool
  serverName: string
}

/** Sanitize server name to produce valid tool name characters: [a-zA-Z0-9_] */
function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

/** Build prefixed tool name: `serverName__toolName` */
export function prefixToolName(serverName: string, toolName: string): string {
  return `${sanitize(serverName)}__${toolName}`
}

/**
 * Wraps MCP tools with server-prefixed names and minimal schemas.
 * First call to each tool returns the full schema; model retries with correct params.
 */
export function wrapMcpToolsLazy(registry: ToolRegistry, mcpTools: McpToolEntry[]): void {
  for (const { tool, serverName } of mcpTools) {
    const name = prefixToolName(serverName, tool.name)
    let revealed = false

    registry.register({
      name,
      description: tool.description,
      inputSchema: {
        type: 'object',
        description: 'Call this tool to receive the full parameter schema, then retry with correct parameters.',
      },
      async execute(input: unknown): Promise<unknown> {
        if (!revealed) {
          revealed = true
          return {
            isError: true,
            content: [
              `Tool "${name}" (from ${serverName}) — full schema below. Retry with correct parameters.`,
              '',
              `Description: ${tool.description}`,
              '',
              'Parameters:',
              JSON.stringify(tool.inputSchema, null, 2),
            ].join('\n'),
          }
        }
        return tool.execute(input)
      },
    })
  }
}
