# Observability

ra has built-in structured logging and tracing. Both emit JSONL — one line per log entry or completed span — to stderr, stdout, a file, or the session directory.

Observability is enabled by default. Logs and traces go to the session directory (`~/.ra/sessions/<id>/logs.jsonl` and `traces.jsonl`).

## Configuration

```yaml
# ra.config.yml
observability:
  enabled: true          # set false to disable all logging/tracing
  logs:
    level: info          # debug | info | warn | error
    output: session      # session | stderr | stdout | file
    filePath: ./ra.log   # required when output is 'file'
  traces:
    output: session      # session | stderr | stdout | file
    filePath: ./traces.jsonl
```

| Config key | Env var | Default | Description |
|------------|---------|---------|-------------|
| `observability.enabled` | `RA_OBSERVABILITY_ENABLED` | `true` | Enable or disable observability |
| `observability.logs.level` | `RA_LOG_LEVEL` | `info` | Minimum log level |
| `observability.logs.output` | `RA_LOG_OUTPUT` | `session` | Where to send logs |
| `observability.logs.filePath` | `RA_LOG_FILE` | — | File path when output is `file` |
| `observability.traces.output` | `RA_TRACE_OUTPUT` | `session` | Where to send traces |
| `observability.traces.filePath` | `RA_TRACE_FILE` | — | File path when output is `file` |

### Output modes

| Mode | Behavior |
|------|----------|
| `session` | Writes to the session directory (`logs.jsonl` / `traces.jsonl`). Falls back to `stderr` if no session is active. |
| `stderr` | Writes to stderr |
| `stdout` | Writes to stdout |
| `file` | Writes to the path specified in `filePath` |

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
observability:
  enabled: false
```

Or via environment variable:

```bash
RA_OBSERVABILITY_ENABLED=false ra "your prompt"
```

When disabled, no-op implementations are used — zero overhead.

## See also

- [Sessions](/core/sessions) — where session logs are stored
- [Middleware](/middleware/) — observability is implemented as built-in middleware hooks
- [Configuration](/configuration/) — full config reference
