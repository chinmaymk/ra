# Sessions

Sessions are how ra persists conversations. Every time you interact with ra — whether through the CLI, REPL, HTTP API, or cron — it creates a session that records the full message history.

## What's stored

Each session lives in its own directory:

```
~/.ra/<project>/sessions/<id>/
  meta.json         # metadata: id, created, provider, model, interface
  messages.jsonl    # append-only message log
  logs.jsonl        # structured logs (when enabled)
  traces.jsonl      # trace spans (when enabled)
```

Messages are stored as JSONL (one JSON object per line, appended as they happen). This means sessions survive crashes — you never lose conversation history.

## Resuming sessions

In the REPL, resume your last session:

```
› /resume
```

Or resume a specific session by ID. Your full conversation history is restored, and you pick up where you left off.

## Session scoping

Sessions are scoped per project. Each project (identified by its data directory) has its own set of sessions, logs, and traces. This keeps work on different projects cleanly separated.

## Auto-pruning

Sessions don't pile up forever. Configure limits to keep things tidy:

```yaml
app:
  storage:
    maxSessions: 100    # keep the most recent 100
    ttlDays: 30         # delete sessions older than 30 days
```

## Memory

Separate from session history, ra has a persistent memory system backed by SQLite with full-text search. Memory lives across sessions — the agent can save facts, search for them later, and forget them when they're no longer relevant.

```yaml
agent:
  memory:
    enabled: true
    maxMemories: 1000
    ttlDays: 90
```

When enabled, the agent gets three tools: `memory_save`, `memory_search`, and `memory_forget`. Middleware can also inject relevant memories at the start of each loop automatically.

Memory is useful for things like user preferences, project conventions, and facts the agent learns over time that shouldn't be tied to a single conversation.

See [Sessions reference](/core/sessions) and [Memory](/tools/#memory) for full details.
