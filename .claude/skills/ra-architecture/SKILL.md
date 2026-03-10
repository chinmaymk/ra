---
name: ra-architecture
description: Use when starting work on the ra codebase, navigating the source, or understanding how components connect.
---

# ra Architecture — Quick Orientation

Every `src/` subdirectory has its own `CLAUDE.md` with detailed docs. This skill gets you oriented fast.

## Where Things Live

| I want to... | Go to |
|---|---|
| Understand the agent loop | `src/agent/CLAUDE.md` → `loop.ts` |
| Add or modify a tool | `src/tools/CLAUDE.md` → tool file → `index.ts` |
| Add or modify a provider | `src/providers/CLAUDE.md` → provider file → `registry.ts` |
| Change config behavior | `src/config/CLAUDE.md` → `types.ts`, `defaults.ts`, `index.ts` |
| Work on CLI/REPL/HTTP | `src/interfaces/CLAUDE.md` → interface file |
| Write middleware | `src/middleware/CLAUDE.md` + `src/agent/types.ts` for context shapes |
| Work on MCP | `src/mcp/CLAUDE.md` → `client.ts` or `server.ts` |
| Work on memory | `src/memory/CLAUDE.md` → `store.ts`, `tools.ts`, `middleware.ts` |
| Work on skills system | `src/skills/CLAUDE.md` → `loader.ts`, `runner.ts` |
| Work on context discovery | `src/context/CLAUDE.md` → `index.ts` |
| Work on session storage | `src/storage/CLAUDE.md` → `sessions.ts` |
| Find tests | `tests/CLAUDE.md` → `tests/<module>/` mirrors `src/<module>/` |

## Core Data Flow

```
Config → Provider + ToolRegistry + Middleware → AgentLoop → Interface (CLI/REPL/HTTP/MCP)
```

## The 5 Key Interfaces

| Type | Location | What |
|------|----------|------|
| `IProvider` | `src/providers/types.ts` | LLM adapter: `chat()` + `stream()` |
| `IMessage` | `src/providers/types.ts` | Unified message format across all providers |
| `ITool` | `src/providers/types.ts` | Tool: `name` + `description` + `inputSchema` + `execute()` |
| `StreamChunk` | `src/providers/types.ts` | Streaming response: `text | thinking | tool_call_* | done` |
| `MiddlewareConfig` | `src/agent/types.ts` | 9 hook arrays with typed contexts |

## First Steps for Any Task

1. Read the relevant `CLAUDE.md` in the target directory
2. Read the existing code you'll modify
3. Check `tests/<module>/` for test patterns
4. When done: `bun tsc` → `bun test` → `git diff` (use the `verify` skill)
