# src/

All source code. Entry point is `index.ts` which parses CLI args, loads config, and routes to the selected interface.

## Module Dependency Flow

```
index.ts (CLI entry)
  → config/ (load and merge config)
  → providers/registry.ts (create provider from config)
  → agent/tool-registry.ts (register built-in + MCP tools)
  → skills/loader.ts (load skills from directories)
  → middleware/loader.ts (load middleware from config)
  → agent/loop.ts (create AgentLoop with all the above)
  → interfaces/{cli,repl,http}.ts or mcp/server.ts (run the loop)
```

## Conventions

- Every module exports named functions/classes, no default exports (except middleware files)
- Types live alongside their module: `providers/types.ts`, `agent/types.ts`, `config/types.ts`
- `types.ts` is the public API entry point for npm consumers
- No circular imports — dependency flows downward through the graph above
