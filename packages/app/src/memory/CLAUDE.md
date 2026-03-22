# src/memory/

SQLite-backed persistent memory with FTS5 full-text search. Memories persist across sessions — separate from session message history.

## Files

| File | Purpose |
|------|---------|
| `store.ts` | `MemoryStore` class — SQLite with WAL mode, FTS5 index, auto-pruning |
| `tools.ts` | Three agent tools: `memory_search`, `memory_save`, `memory_forget` |
| `middleware.ts` | `beforeLoopBegin` hook: prunes expired memories, injects top N as `<recalled-memories>` |
| `index.ts` | Module exports |

## How It Works

1. **Middleware** runs at `beforeLoopBegin` — prunes expired entries, then injects the most recent memories (up to `injectLimit`) as a `<recalled-memories>` user message
2. **Agent tools** let the model explicitly save, search, and forget memories during execution
3. **FTS5 triggers** keep the full-text index in sync with inserts/deletes automatically

## Config

The memory database is stored at `{dataDir}/memory.db`. The `dataDir` defaults to `~/.ra/<config-handle>/` (centralized, namespaced by project).

```yaml
# dataDir defaults to ~/.ra/<config-handle>/
memory:
  enabled: false          # off by default
  maxMemories: 1000       # auto-trim oldest when exceeded
  ttlDays: 90             # auto-prune entries older than this
  injectLimit: 5          # max memories injected per loop start
```

## Key Detail

Memories are NOT stored in session message history. They live in a separate SQLite database and are injected fresh at each loop start via middleware.
