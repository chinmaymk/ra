# MCP

ra speaks MCP ([Model Context Protocol](https://modelcontextprotocol.io)) in both directions — as a client that uses tools from external MCP servers, and as a server that exposes the full agent loop as a tool for other apps.

## ra as MCP client

Connect ra to external MCP servers. Their tools become available to the model automatically — ra discovers tool schemas from MCP and presents them alongside the built-in tools. Tool names are prefixed with the server name to avoid conflicts (e.g., a `search_repos` tool from the `github` server becomes `github_search_repos`).

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
