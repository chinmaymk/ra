# Sessions

ra persists every conversation as JSONL. Resume any session from any interface — CLI, REPL, or HTTP.

## Resuming a session

**CLI:**

```bash
ra --resume <session-id> "Continue with the next step"
```

**REPL:**

```
› /resume abc-123
```

**HTTP API:**

```json
{
  "messages": [{ "role": "user", "content": "Continue" }],
  "sessionId": "abc-123"
}
```

## Auto-save

Sessions are saved automatically after each turn. You never need to explicitly save.

When `ask_user` suspends a CLI run, the session ID is printed to stderr so you can resume later:

```
Session suspended. Resume with: ra --resume ses_abc123
```

## Listing sessions

```bash
ra session list
```

Via the HTTP API:

```bash
curl http://localhost:3000/sessions
```

## Configuration

```yaml
storage:
  path: .ra/sessions    # where sessions are stored
  maxSessions: 100      # max sessions to keep (auto-prune oldest)
  ttlDays: 30           # auto-expire sessions older than this
```

## Storage format

Sessions are stored as JSONL files — one line per message. This makes them easy to inspect, grep, or process with standard tools:

```bash
cat .ra/sessions/ses_abc123.jsonl | head -5
```

## See also

- [CLI](/modes/cli) — resuming sessions from the command line
- [REPL](/modes/repl) — `/resume` and `/clear` commands
- [HTTP API](/api/) — `sessionId` field in requests
- [Configuration](/configuration/) — storage settings
