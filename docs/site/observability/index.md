# Observability

ra has built-in structured logging and tracing. Both emit JSONL — one line per log entry or completed span — to stderr, stdout, a file, or the session directory.

Observability is enabled by default. Logs and traces go to the session directory (`~/.ra/sessions/<id>/logs.jsonl` and `traces.jsonl`).

## Configuration

```yaml
# ra.config.yml
logsEnabled: true        # toggle session logs (default: true)
logLevel: info           # debug | info | warn | error
tracesEnabled: true      # toggle session traces (default: true)
```

| Config key | Env var | Default | Description |
|------------|---------|---------|-------------|
| `logsEnabled` | `RA_LOGS_ENABLED` | `true` | Enable or disable session logs |
| `logLevel` | `RA_LOG_LEVEL` | `info` | Minimum log level |
| `tracesEnabled` | `RA_TRACES_ENABLED` | `true` | Enable or disable session traces |

Logs and traces are always written to the session directory (`{dataDir}/sessions/<id>/logs.jsonl` and `traces.jsonl`). When no session is active, they fall back to `stderr`.

## Logs

Structured JSONL log entries with timestamps, levels, and contextual data.

```jsonl
{"timestamp":"2026-03-11T10:00:00.000Z","level":"info","message":"agent loop starting","maxIterations":50,"messageCount":1}
{"timestamp":"2026-03-11T10:00:01.000Z","level":"info","message":"calling model","iteration":1,"model":"claude-sonnet-4-6","messageCount":1}
{"timestamp":"2026-03-11T10:00:03.000Z","level":"info","message":"model responded","iteration":1,"inputTokens":1200,"outputTokens":350,"toolCallCount":1,"toolNames":["execute_bash"]}
{"timestamp":"2026-03-11T10:00:04.000Z","level":"info","message":"executing tool","tool":"execute_bash","toolCallId":"call_abc"}
{"timestamp":"2026-03-11T10:00:05.000Z","level":"info","message":"tool execution complete","tool":"execute_bash","toolCallId":"call_abc","resultLength":42}
{"timestamp":"2026-03-11T10:00:08.000Z","level":"info","message":"agent loop complete","iterations":2,"inputTokens":2400,"outputTokens":700,"totalMessages":5}
```

Log levels filter by severity — `debug` is most verbose, `error` is least.

## Traces

Span-based tracing that captures the timing and hierarchy of each agent loop run. Each span records duration, status, and attributes.

### Span hierarchy

```
agent.loop
  └── agent.iteration (one per loop iteration)
        ├── agent.model_call
        └── agent.tool_execution (one per tool call)
```

### Trace output

```jsonl
{"type":"span","timestamp":"2026-03-11T10:00:03.000Z","traceId":"abc-123","spanId":"span-1","name":"agent.model_call","durationMs":1523.4,"status":"ok","attributes":{"model":"claude-sonnet-4-6","inputTokens":1200,"outputTokens":350,"toolCallCount":1}}
{"type":"span","timestamp":"2026-03-11T10:00:05.000Z","traceId":"abc-123","spanId":"span-2","parentSpanId":"span-iter-1","name":"agent.tool_execution","durationMs":812.1,"status":"ok","attributes":{"tool":"execute_bash","resultLength":42}}
```

### Span attributes

**`agent.loop`** — root span for the entire agent run:
- `maxIterations`, `initialMessageCount` (start)
- `iterations`, `inputTokens`, `outputTokens`, `totalMessages` (end)

**`agent.iteration`** — one per loop iteration:
- `iteration`, `messageCount` (start)
- `messagesAdded` (end)

**`agent.model_call`** — the LLM API call:
- `model`, `messageCount` (start)
- `inputTokens`, `outputTokens`, `thinkingTokens`, `toolCallCount`, `toolNames`, `responseLength` (end)

**`agent.tool_execution`** — each tool invocation:
- `tool`, `toolCallId` (start)
- `resultLength`, `error` (end)

Subagent tool calls include additional attributes: `taskCount`, `tasks`, `tasksCompleted`, `tasksErrored`, `totalInputTokens`, `totalOutputTokens`.

## Viewing session logs

When using the default `session` output mode, logs and traces are stored alongside the session data:

```bash
# Find the session directory
ls ~/.ra/sessions/

# View logs
cat ~/.ra/sessions/<session-id>/logs.jsonl | jq .

# View traces
cat ~/.ra/sessions/<session-id>/traces.jsonl | jq .

# Filter for errors
cat ~/.ra/sessions/<session-id>/logs.jsonl | jq 'select(.level == "error")'

# Find slow tool calls
cat ~/.ra/sessions/<session-id>/traces.jsonl | jq 'select(.name == "agent.tool_execution" and .durationMs > 5000)'
```

## Disabling observability

```yaml
logsEnabled: false
tracesEnabled: false
```

Or via environment variables:

```bash
RA_LOGS_ENABLED=false RA_TRACES_ENABLED=false ra "your prompt"
```

When disabled, no-op implementations are used — zero overhead.

## See also

- [Sessions](/core/sessions) — where session logs are stored
- [Middleware](/middleware/) — observability is implemented as built-in middleware hooks
- [Configuration](/configuration/) — full config reference
