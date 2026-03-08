# MCP

ra speaks MCP in both directions — as a client that uses tools from external MCP servers, and as a server that exposes the full agent loop as a tool for other apps.

## ra as MCP client

Connect ra to external MCP servers. Their tools become available to the model automatically.

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

Run the MCP server alongside another interface — for example, a REPL with an MCP sidecar:

```bash
ra --mcp-server-enabled --mcp-server-port 4000 --repl
```
