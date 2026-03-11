# src/storage/

JSONL-based session persistence. Used by REPL and HTTP interfaces.

## Files

| File | Purpose |
|------|---------|
| `sessions.ts` | `SessionStorage` class — create, append, read, list, prune sessions |

## Session Directory Layout

```
{storagePath}/{sanitized-uuid}/
  meta.json          # Session metadata: id, created, provider, model, interface
  messages.jsonl     # One IMessage per line (append-only)
  checkpoint.json    # Optional checkpoint data
  logs.jsonl         # Observability logs (when output is 'session')
  traces.jsonl       # Observability traces (when output is 'session')
```

## Config

```yaml
storage:
  path: ".ra/sessions"   # base directory
  format: "jsonl"         # message log format
  maxSessions: 100        # prune oldest beyond this
  ttlDays: 30             # prune sessions older than this
```

## Key Methods

- `create(meta)` — creates session directory + meta.json
- `appendMessage(sessionId, message)` — appends one line to messages.jsonl
- `readMessages(sessionId)` — reads all messages back as `IMessage[]`
- `list()` — lists all sessions with metadata
- `prune()` — removes sessions exceeding `maxSessions` or `ttlDays`
