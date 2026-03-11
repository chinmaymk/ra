import type { ITool } from '../providers/types'
import type { ToolRegistry } from '../agent/tool-registry'

export interface McpToolEntry {
  tool: ITool
  serverName: string
}

/**
 * Wraps MCP tools with server-prefixed names and minimal schemas.
 * Tool names become `serverName__toolName` to avoid conflicts across servers.
 * On the first call to each tool, returns the full schema instead of executing —
 * the model then retries with correct parameters.
 */
export function wrapMcpToolsLazy(
  registry: ToolRegistry,
  mcpTools: McpToolEntry[],
): void {
  for (const { tool, serverName } of mcpTools) {
    const prefixedName = `${serverName}__${tool.name}`
    let revealed = false

    registry.register({
      name: prefixedName,
      description: tool.description,
      inputSchema: {
        type: 'object',
        description: `Schema not shown to save tokens. Call this tool to receive the full parameter schema, then retry with correct parameters.`,
      },
      async execute(input: unknown): Promise<unknown> {
        if (!revealed) {
          revealed = true
          return {
            isError: true,
            content: formatSchemaHint(tool, prefixedName, serverName),
          }
        }
        return tool.execute(input)
      },
    })
  }
}

function formatSchemaHint(tool: ITool, prefixedName: string, serverName: string): string {
  return [
    `Tool "${prefixedName}" (from ${serverName}) — here is the full schema. Retry your call with the correct parameters.`,
    ``,
    `Description: ${tool.description}`,
    ``,
    `Parameters:`,
    JSON.stringify(tool.inputSchema, null, 2),
  ].join('\n')
}
