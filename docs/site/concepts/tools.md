# Tools

Tools are functions that the model can call during the [agent loop](/concepts/agent-loop). When the model decides it needs to read a file, run a command, or fetch a URL, it emits a tool call — ra executes it and feeds the result back.

The model doesn't execute tools directly. It describes _what_ it wants to do, and ra handles the _how_.

## Built-in tools

ra ships with tools for the most common agent tasks:

| Category | Tools |
|----------|-------|
| **Filesystem** | `Read`, `Write`, `Edit`, `Glob`, `Grep`, `LS`, `MoveFile`, `CopyFile`, `DeleteFile`, `AppendFile` |
| **Shell** | `Bash` (Linux/Mac), `PowerShell` (Windows) |
| **Network** | `WebFetch` |
| **Agent** | `Agent` (spawn sub-agents for parallel work) |

These cover file manipulation, code search, shell commands, and HTTP requests — enough for most coding and automation tasks.

## MCP tools

Beyond built-in tools, ra can connect to external [MCP servers](/modes/mcp) to pull in additional tools. This means you can give your agent access to databases, APIs, Slack, GitHub, or anything else that exposes an MCP interface.

```yaml
app:
  mcpServers:
    - name: github
      transport: stdio
      command: npx @modelcontextprotocol/server-github
```

MCP tools are prefixed with the server name (e.g., `github__create_issue`) to avoid conflicts with built-in tools.

## How tools work

Each tool defines:

- **name** — what the model calls it (e.g., `Read`)
- **description** — tells the model when and how to use it
- **inputSchema** — JSON Schema for the tool's parameters
- **execute()** — the function that runs when the tool is called

When the model emits a tool call, ra:

1. Looks up the tool in the registry
2. Checks [permissions](/permissions/) (if configured)
3. Fires `beforeToolExecution` middleware
4. Calls `execute()` with the parsed arguments
5. Fires `afterToolExecution` middleware
6. Sends the result back to the model

## Permissions

You can restrict what tools are allowed to do using regex-based rules:

```yaml
agent:
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["rm -rf", "--force"]
```

When a tool call is denied, the model receives a clear error message and can adjust its approach. See [Permissions](/permissions/) for the full rule format.

## Timeouts

Each tool call has a timeout (default: 120 seconds). Long-running commands won't hang the loop forever:

```yaml
agent:
  toolTimeout: 120000  # ms
```

See [Built-in Tools](/tools/) for details on each tool.
