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
 * Wraps MCP tools with lightweight stubs that only include name + truncated description.
 * The model can request full schemas via the `get_mcp_tool_schema` meta-tool before calling.
 * Each tool is tagged with its source MCP server name so the model can tell them apart.
 */
export function wrapMcpToolsLazy(
  registry: ToolRegistry,
  mcpTools: McpToolEntry[],
  options?: LazyToolsOptions,
): void {
  const maxLen = options?.maxDescriptionLength ?? DEFAULT_MAX_DESCRIPTION_LENGTH
  const fullSchemas = new Map<string, { serverName: string; description: string; inputSchema: Record<string, unknown> }>()

  for (const { tool, serverName } of mcpTools) {
    // Store full schema for later retrieval
    fullSchemas.set(tool.name, {
      serverName,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })

    // Register a lightweight stub — same name, same execute, but minimal schema
    const prefix = `[${serverName}] `
    registry.register({
      name: tool.name,
      description: prefix + truncateDescription(tool.description, maxLen - prefix.length),
      inputSchema: {
        type: 'object',
        description: `Call get_mcp_tool_schema with tool name "${tool.name}" to get the full parameter schema before using this tool.`,
      },
      execute: tool.execute,
    })
  }

  // Build a grouped listing of tools by server for the meta-tool description
  const serverTools = new Map<string, string[]>()
  for (const { tool, serverName } of mcpTools) {
    const list = serverTools.get(serverName) ?? []
    list.push(tool.name)
    serverTools.set(serverName, list)
  }
  const serverListing = [...serverTools.entries()]
    .map(([server, tools]) => `${server}: ${tools.join(', ')}`)
    .join('; ')

  // Register the meta-tool for schema retrieval
  registry.register({
    name: 'get_mcp_tool_schema',
    description: `Retrieve the full description and parameter schema for an MCP tool before calling it. Available tools by server — ${serverListing}`,
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: {
          type: 'string',
          description: 'Name of the MCP tool to get the schema for',
        },
      },
      required: ['tool_name'],
    },
    async execute(input: unknown) {
      const { tool_name } = input as { tool_name: string }
      const schema = fullSchemas.get(tool_name)
      if (!schema) {
        const available = [...fullSchemas.entries()].map(([name, s]) => `${name} (${s.serverName})`)
        return { error: `Unknown MCP tool: "${tool_name}". Available MCP tools: ${available.join(', ')}` }
      }
      return {
        name: tool_name,
        server: schema.serverName,
        description: schema.description,
        inputSchema: schema.inputSchema,
      }
    },
  })
}

function truncateDescription(description: string, maxLen: number): string {
  if (maxLen <= 3) return '...'
  if (description.length <= maxLen) return description
  return description.slice(0, maxLen - 3) + '...'
}
