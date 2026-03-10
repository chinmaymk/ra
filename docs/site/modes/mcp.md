# MCP

ra speaks MCP ([Model Context Protocol](https://modelcontextprotocol.io)) in both directions — as a client that uses tools from external MCP servers, and as a server that exposes the full agent loop as a tool for other apps.

## ra as MCP client

Connect ra to external MCP servers. Their tools become available to the model automatically — ra discovers tool schemas from MCP and presents them alongside the built-in tools.

```yaml
# ra.config.yml
mcp:
  client:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@anthropic/mcp-filesystem"]
    - name: database
      transport: sse
      url: http://localhost:8080/mcp
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
```

To use only MCP tools (without built-in tools), disable built-in tools:

```yaml
builtinTools: false
mcp:
  client:
    - name: my-tools
      transport: stdio
      command: ./my-mcp-server
```

### Lazy schema loading

MCP servers can expose dozens of tools, each with large JSON schemas. Sending all of them in every model call wastes tokens — especially when only a few tools are used per conversation.

By default, ra uses **lazy schema loading** for MCP tools. Instead of sending full schemas, the model sees only tool names, their source server (as a `[server]` prefix), and truncated descriptions. When the model first calls a tool, ra returns the full schema instead of executing it — the model then retries with the correct parameters.

```
Model sees:
  search_github  →  "[github] Search for repositories, issues, and..."
  query_db       →  "[database] Run SQL queries against the..."

Model calls: search_github({})                    ← first call, guessing
     ↓
ra returns:  schema error with full description + inputSchema
     ↓
Model calls: search_github({ query: "...", repo: "..." })  ← retry with correct params
     ↓
ra executes: real MCP tool call
```

No extra meta-tools needed. The model learns the schema through normal tool-call error handling — one extra round-trip per tool, only for tools actually used.

This is especially effective when connecting to multiple MCP servers with many tools — you only pay the token cost for schemas the model actually uses.

```yaml
# ra.config.yml
mcp:
  lazySchemas: true          # default: true
  maxDescriptionLength: 100  # max chars for truncated descriptions
```

To disable lazy loading and send full schemas every time (the pre-optimization behavior):

```yaml
mcp:
  lazySchemas: false
```

| Field | Env var | Default | Description |
|-------|---------|---------|-------------|
| `mcp.lazySchemas` | `RA_MCP_LAZY_SCHEMAS` | `true` | Enable lazy schema loading for MCP tools |
| `mcp.maxDescriptionLength` | `RA_MCP_MAX_DESCRIPTION_LENGTH` | `100` | Max characters for truncated MCP tool descriptions |

## ra as MCP server

Expose the full agent loop as a tool for other agents.

```bash
ra --mcp-stdio   # stdio transport (for Cursor, Claude Desktop)
ra --mcp         # HTTP transport (default port 3001)
```

When built-in tools are enabled, they're also exposed as individual MCP tools — so other agents get access to ra's filesystem, shell, and network tools directly.

### Cursor / Claude Desktop integration

```json
{
  "mcpServers": {
    "ra": {
      "command": "ra",
      "args": ["--mcp-stdio"]
    }
  }
}
```

Add skills and a system prompt for a specialized tool:

```json
{
  "mcpServers": {
    "code-reviewer": {
      "command": "ra",
      "args": ["--mcp-stdio", "--skill", "code-review"]
    }
  }
}
```

### MCP sidecar

Run the MCP server alongside another interface — for example, a REPL with an MCP sidecar so other tools can connect while you work interactively:

```bash
ra --mcp-server-enabled --mcp-server-port 4000 --repl
```

## See also

- [Built-in Tools](/tools/) — the 14 tools exposed via MCP
- [Configuration](/configuration/) — MCP client configuration
- [Recipes](/recipes/) — MCP tool in Claude Desktop recipe
