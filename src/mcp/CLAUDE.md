# src/mcp/

MCP (Model Context Protocol) support — both as a client (connect to external tool servers) and as a server (expose ra as a tool).

## Files

| File | Purpose |
|------|---------|
| `client.ts` | Connects to external MCP servers, registers their tools into `ToolRegistry` |
| `lazy-tools.ts` | Lazy schema loading — wraps MCP tools with minimal stubs, returns full schema on first call |
| `server.ts` | Exposes ra itself as an MCP tool (stdio or HTTP transport) |

## MCP Client

Configured via `mcp.client[]` in config:
```yaml
mcp:
  client:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
```

- Lists tools from the external server and wraps them as `ITool` instances
- Registered into the same `ToolRegistry` as built-in tools — the agent sees them identically
- Supports `stdio` and `sse` transports

### Lazy Schema Loading (`lazy-tools.ts`)

When `mcp.lazySchemas` is enabled (default: `true`), MCP tools are registered with:
- A `[serverName]` prefix in the description so the model knows which server owns each tool
- Truncated descriptions (max `mcp.maxDescriptionLength` chars, default 100)
- Minimal `inputSchema` (no properties)

On the **first call** to each tool, the wrapper returns the full schema as an error (`isError: true`) with the complete description, server name, and `inputSchema`. The model then retries with correct parameters, and all subsequent calls pass through to the real MCP server.

No meta-tools needed — the model learns schemas through normal error handling.

`wrapMcpToolsLazy(registry, McpToolEntry[], options?)` is the entry point. Each `McpToolEntry` pairs an `ITool` with its `serverName`. A per-tool `Set` tracks which tools have been "revealed".

## MCP Server

Configured via `mcp.server` in config. Exposes:
- The agent itself as a single MCP tool (name + description configurable)
- All built-in tools except `ask_user` as individual MCP tools
- Supports stdio (long-lived child process) and HTTP (per-session with `mcp-session-id` header) transports
