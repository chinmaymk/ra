# src/mcp/

MCP (Model Context Protocol) support — both as a client (connect to external tool servers) and as a server (expose ra as a tool).

## Files

| File | Purpose |
|------|---------|
| `client.ts` | Connects to external MCP servers, registers their tools into `ToolRegistry` |
| `lazy-tools.ts` | Server-prefixed naming (`prefixToolName`) + lazy schema loading (`wrapMcpToolsLazy`) |
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
- **All MCP tools get server-prefixed names**: `serverName__toolName` (avoids conflicts across servers)
- Server names are sanitized to `[a-zA-Z0-9_]` for provider compatibility
- Registered into the same `ToolRegistry` as built-in tools — the agent sees them identically
- Supports `stdio` and `sse` transports

### Lazy Schema Loading (`lazy-tools.ts`)

When `mcp.lazySchemas` is enabled (default: `true`), MCP tools are additionally registered with:
- Minimal `inputSchema` (no properties)
- A first-call reveal: returns the full schema as an error (`isError: true`), model retries with correct params

`prefixToolName(serverName, toolName)` is used by both lazy and non-lazy paths. `wrapMcpToolsLazy(registry, McpToolEntry[])` adds the schema-stripping behavior on top.

## MCP Server

Configured via `mcp.server` in config. Exposes:
- The agent itself as a single MCP tool (name + description configurable)
- All built-in tools except `ask_user` as individual MCP tools
- Supports stdio (long-lived child process) and HTTP (per-session with `mcp-session-id` header) transports
