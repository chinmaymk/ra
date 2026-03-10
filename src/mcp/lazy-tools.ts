import type { ITool } from '../providers/types'
import type { ToolRegistry } from '../agent/tool-registry'

const DEFAULT_MAX_DESCRIPTION_LENGTH = 100

export interface McpToolEntry {
  tool: ITool
  serverName: string
}

export interface LazyToolsOptions {
  /** Max characters for truncated descriptions sent to the model */
  maxDescriptionLength?: number
}

/**
 * Wraps MCP tools with lightweight stubs: truncated descriptions, minimal schemas,
 * and a [serverName] prefix. On the first call to each tool, returns the full schema
 * instead of executing — the model then retries with correct parameters.
 */
export function wrapMcpToolsLazy(
  registry: ToolRegistry,
  mcpTools: McpToolEntry[],
  options?: LazyToolsOptions,
): void {
  const maxLen = options?.maxDescriptionLength ?? DEFAULT_MAX_DESCRIPTION_LENGTH

  for (const { tool, serverName } of mcpTools) {
    const prefix = `[${serverName}] `
    let revealed = false

    registry.register({
      name: tool.name,
      description: prefix + truncateDescription(tool.description, maxLen - prefix.length),
      inputSchema: {
        type: 'object',
        description: `Schema not shown to save tokens. Call this tool to receive the full parameter schema, then retry with correct parameters.`,
      },
      async execute(input: unknown): Promise<unknown> {
        if (!revealed) {
          revealed = true
          return {
            isError: true,
            content: formatSchemaHint(tool, serverName),
          }
        }
        return tool.execute(input)
      },
    })
  }
}

function formatSchemaHint(tool: ITool, serverName: string): string {
  return [
    `Tool "${tool.name}" (from ${serverName}) — here is the full schema. Retry your call with the correct parameters.`,
    ``,
    `Description: ${tool.description}`,
    ``,
    `Parameters:`,
    JSON.stringify(tool.inputSchema, null, 2),
  ].join('\n')
}

function truncateDescription(description: string, maxLen: number): string {
  if (maxLen <= 3) return '...'
  if (description.length <= maxLen) return description
  return description.slice(0, maxLen - 3) + '...'
}
