# MCP

ra speaks MCP in both directions.

## ra as MCP client (uses tools)

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
```

## ra as MCP server (is a tool)

```bash
ra --mcp-stdio    # stdio transport (for Cursor, Claude Desktop)
ra --mcp          # HTTP transport (default port 3001)
```

When you run `--mcp-stdio`, ra prints the JSON config snippet to paste into your MCP client.

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
