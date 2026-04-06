# Hot-Reload

ra watches your config file and all files it references — system prompts, middleware scripts, custom tools, context resolvers — and reloads them automatically between agent loops. Edit a file, send the next message, and the agent picks up your changes. No restart needed.

## How it works

Before each agent loop (each REPL input or HTTP request), ra checks the mtime of every tracked file. If any file has been modified since the last check, ra:

1. **Reloads the config** — re-reads and re-merges `ra.config.yaml` with defaults, env vars, and CLI args
2. **Rebuilds the provider** — if the provider name or credentials changed
3. **Rebuilds tools** — re-imports custom tool files, re-registers builtins
4. **Rebuilds middleware** — re-imports middleware scripts, re-wires system hooks
5. **Rebuilds skills** — re-scans skill directories
6. **Rebuilds context** — re-discovers context files if patterns changed

Long-lived state is preserved: storage, MCP server connections, memory and scratchpad stores, and observability pipelines are never disrupted.

## What's tracked

| File type | Example | Detected how |
|-----------|---------|-------------|
| Config file | `ra.config.yaml` | Always tracked |
| System prompt | `./prompt.txt` | Tracked when `systemPrompt` points to a file |
| Middleware scripts | `./middleware/budget.ts` | File path entries in `agent.middleware` |
| Custom tools | `./tools/search.ts` | Entries in `agent.tools.custom` |
| Context resolvers | `./resolvers/jira.ts` | `agent.context.resolvers[].path` |

Inline middleware expressions (`(ctx) => { ... }`) and `shell:` entries are not tracked — only file paths.

## Configuration

Hot-reload is **enabled by default**. To disable it:

```yaml
agent:
  hotReload: false
```

When disabled, config is loaded once at startup and never re-checked. This saves a few `stat()` calls per request if your config never changes at runtime.

## Example: live system prompt editing

```yaml
# ra.config.yaml
agent:
  systemPrompt: ./prompts/system.md
```

```bash
# Terminal 1: start the agent
ra

# Terminal 2: edit the prompt while the agent is running
echo "You are a pirate. Respond only in pirate speak." > prompts/system.md
```

The next message you send in Terminal 1 uses the new prompt — no restart.

## Example: iterating on a custom tool

```yaml
agent:
  tools:
    custom:
      - ./tools/deploy.ts
```

Edit `tools/deploy.ts` in your editor. The next time the agent calls the tool, it runs the updated code.

## Example: tweaking middleware

```yaml
agent:
  middleware:
    afterToolExecution:
      - ./middleware/audit.ts
```

Modify `audit.ts` to change what gets logged. Changes take effect on the next agent loop.

## Concurrency

For HTTP servers handling concurrent requests, reloads are serialized — if two requests arrive simultaneously and both detect a file change, only one reload runs. The second request waits for the first reload to finish and reuses its result.

## Caveats

- **MCP connections are not restarted.** Adding or removing `app.mcpServers` entries requires a restart. Existing MCP tools are preserved across reloads.
- **App-level settings** (`app.interface`, `app.http.port`, `app.dataDir`) are bound at startup. Changing them in the config has no effect until restart.
- **Module cache is cleared on reload.** When a `.ts` or `.js` file is re-imported, the previous module is evicted from the cache. This means module-level state (counters, caches) resets on each reload.
