# Sessions

ra persists every conversation as JSONL. Resume any session from any interface.

## Resuming sessions

```bash
ra --resume <session-id> "Continue with the next step"
```

In the REPL:

```
> /resume abc-123
```

In the HTTP API, pass `sessionId` in the request body:

```json
{
  "messages": [{ "role": "user", "content": "Continue" }],
  "sessionId": "abc-123"
}
```

## How it works

Sessions are auto-saved after each turn. When `ask_user` suspends a CLI run, the session ID is printed to stderr so you can resume later.

## Configuration

```yaml
storage:
  path: .ra/sessions    # where sessions are stored
  maxSessions: 100      # max sessions to keep (auto-prune oldest)
  ttlDays: 30           # auto-expire sessions older than this
```

Sessions are stored as JSONL files — one line per message. This makes them easy to inspect, grep, or process with standard tools.
