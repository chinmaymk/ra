# MCP

ra speaks MCP in both directions.

## ra as MCP client (uses tools)

Add MCP server configs to `ra.config.yml` and ra connects to them at startup, discovers their tools, and registers them with the model. The model calls them like any other function.

```yaml
mcp:
  servers:
    - name: filesystem
      command: npx
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
```

## ra as MCP server (is a tool)

```bash
ra --mcp
```

ra exposes itself as a single MCP tool that takes a prompt and runs the full agent loop. Other apps — Cursor, Claude Desktop, your own agents — can call it.

### Cursor integration

Add to your Cursor MCP config:

```json
{
  "mcpServers": {
    "ra": {
      "command": "ra",
      "args": ["--mcp"]
    }
  }
}
```

### Claude Desktop integration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ra": {
      "command": "ra",
      "args": ["--mcp"]
    }
  }
}
```
