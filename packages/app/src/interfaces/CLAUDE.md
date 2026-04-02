# src/interfaces/

Four entry points that wire up the agent loop with different I/O patterns. All share the same wiring sequence:

```
loadConfig() → createProvider() → ToolRegistry + MCP tools → loadSkills() → loadMiddleware()
  → new AgentLoop({ provider, tools, middleware, ... })
  → loop.run(initialMessages)
```

## Files

| File | Purpose |
|------|---------|
| `launchers.ts` | Interface launcher functions + signal helpers (called from `index.ts`) |
| `cli.ts` | One-shot mode: takes a prompt, runs the loop once, exits |
| `repl.ts` | Interactive mode: readline loop, session persistence, `/slash` commands |
| `http.ts` | HTTP server: `POST /chat` (SSE streaming) and `POST /chat/sync` (JSON) |
| `inspector.ts` | Inspector web UI server (session viewer, config, memory CRUD) |
| `inspector-stats.ts` | Pure functions: stats aggregation + timeline building for inspector |
| `cron.ts` | Cron scheduler: runs agent jobs on cron expressions |
| `messages.ts` | Shared message threading: `buildThreadMessages`, `createSessionLoop` |
| `commands.ts` | Standalone CLI commands (`--exec`, `--show-context`, subcommands) |
| `parse-args.ts` | CLI argument parser shared across interfaces |
| `tui.ts` | Terminal UI utilities (spinners, thinking boxes, tool timing) |

## Interface Differences

| | CLI | REPL | HTTP |
|---|---|---|---|
| Loop calls | Single `run()` | `run()` per user input | `run()` per POST request |
| Sessions | None (one-shot) | Auto-saved per turn | Optional via `sessionId` |
| Streaming | `onChunk` callback | TUI middleware | Server-Sent Events |

## Skill Injection

- Active skills → full XML user messages
- Available skills → `<available-skills>` XML (skipped if `messages.length > 0` in REPL to avoid repetition)
- Context files → user messages before session messages

## Adding a New Interface

Use `cli.ts` as a template. The pattern is:
1. Call `loadConfig()` and merge CLI args
2. Create provider, tool registry, middleware
3. Build initial messages (system prompt + skills + context + user input)
4. Instantiate `AgentLoop` and call `run()`
