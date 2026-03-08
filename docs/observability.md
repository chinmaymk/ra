# Observability

ra ships with built-in structured logging and tracing, enabled by default.

- **Logs** tell you *what happened*: human-readable structured events describing agent actions, decisions, and errors.
- **Traces** tell you *where it happened*: span hierarchy with timing data for visualizing execution flow in tools like Jaeger.

Observability is implemented as middleware — it hooks into ra's existing lifecycle hooks without touching business logic. A single call to `createObservabilityMiddleware()` produces a complete middleware set that covers all 9 hooks.

## Architecture

```
index.ts                         observability/middleware.ts
────────                         ──────────────────────────
createObservability(config)  →   Logger + Tracer instances
createObservabilityMiddleware()  →   { beforeLoopBegin, beforeModelCall, ... }
Prepended into middleware chain  →   obs hooks run first, then user middleware

No logger/tracer params threaded through the codebase.
The loop, tools, memory — none know about observability.
Compaction uses an onCompact callback for logging without coupling to Logger.
```

## Configuration

```json
{
  "observability": {
    "enabled": true,
    "logs": {
      "level": "info",
      "output": "stderr",
      "filePath": "./logs/ra.log.jsonl"
    },
    "traces": {
      "output": "file",
      "filePath": "./logs/ra.traces.jsonl"
    }
  }
}
```

Or via environment variables:

```bash
RA_OBSERVABILITY_ENABLED=true

# Logs
RA_LOG_LEVEL=debug          # debug | info | warn | error
RA_LOG_OUTPUT=file           # stderr | stdout | file
RA_LOG_FILE=./logs/ra.log.jsonl

# Traces
RA_TRACE_OUTPUT=file         # stderr | stdout | file
RA_TRACE_FILE=./logs/ra.traces.jsonl
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable all observability |
| `logs.level` | `info` | Minimum log level (`debug`, `info`, `warn`, `error`) |
| `logs.output` | `stderr` | Log output destination (`stderr`, `stdout`, `file`) |
| `logs.filePath` | — | File path when `logs.output` is `file` |
| `traces.output` | `stderr` | Trace output destination (`stderr`, `stdout`, `file`) |
| `traces.filePath` | — | File path when `traces.output` is `file` |

## Logs

Logs are structured JSON events describing *what the agent did*. Each line is a self-contained JSON object with a fixed `message` key and structured data fields:

```json
{"timestamp":"2026-03-08T14:32:01.123Z","level":"info","message":"executing tool","sessionId":"abc-123","tool":"shell","toolCallId":"tc_1","input":"{\"command\":\"ls -la\"}"}
{"timestamp":"2026-03-08T14:32:01.250Z","level":"info","message":"tool execution complete","sessionId":"abc-123","tool":"shell","toolCallId":"tc_1","resultLength":1024}
{"timestamp":"2026-03-08T14:32:01.500Z","level":"info","message":"model responded","sessionId":"abc-123","iteration":1,"inputTokens":150,"outputTokens":45,"toolCallCount":2,"toolNames":["shell","read_file"]}
```

### Log Events Reference

**Initialization** (emitted in `index.ts` during startup):

| Message | Level | Data Fields |
|---------|-------|-------------|
| `provider initialized` | info | `provider`, `model` |
| `tools registered` | info | `toolCount`, `tools` |
| `custom middleware loaded` | info | `hookCount` |
| `session storage initialized` | debug | `path` |
| `skills loaded` | info | `skillCount`, `skills` |
| `memory store initialized` | info | `path`, `memoriesStored` |
| `connecting to MCP servers` | info | `serverCount`, `servers` |
| `MCP servers connected` | info | `totalTools` |
| `context files discovered` | info | `fileCount`, `patterns`, `files` |
| `resuming session` | info | `sessionId`, `messageCount` |
| `starting interface` | info | `interface` |
| `shutting down` | info | — |

**Agent loop** (emitted by observability middleware):

| Message | Level | Data Fields |
|---------|-------|-------------|
| `agent loop starting` | info | `maxIterations`, `messageCount` |
| `calling model` | debug | `iteration`, `model`, `messageCount` |
| `model responded` | info | `iteration`, `inputTokens`, `outputTokens`, `toolCallCount`, `toolNames`, `responseLength` |
| `executing tool` | info | `tool`, `toolCallId`, `input` (preview, 200 chars) |
| `tool execution complete` | info | `tool`, `toolCallId`, `resultLength` |
| `tool execution failed` | error | `tool`, `toolCallId`, `error` |
| `context compacted` | info | `originalMessages`, `compactedMessages`, `estimatedTokens`, `threshold` |
| `iteration complete` | debug | `iteration`, `messagesAdded`, `totalMessages` |
| `agent loop complete` | info | `iterations`, `inputTokens`, `outputTokens`, `totalMessages` |
| `agent loop failed` | error | `error`, `stack`, `phase`, `iterations` |

## Traces

Traces are structured JSON records describing *where execution happened* — the span hierarchy, timing, and parent-child relationships. Each completed span emits one record:

```json
{"type":"span","timestamp":"2026-03-08T14:32:01.500Z","traceId":"abc-123","spanId":"span-1","parentSpanId":"span-0","name":"agent.tool_execution","durationMs":142.5,"status":"ok","attributes":{"sessionId":"abc-123","tool":"shell","toolCallId":"tc_1"}}
```

### Span Hierarchy

```
agent.loop (traceId: abc-123)
  └── agent.iteration (iteration: 1)
      ├── agent.model_call (model: claude-sonnet-4-6, 142ms)
      ├── agent.tool_execution (tool: shell, 87ms)
      └── agent.tool_execution (tool: read_file, 12ms)
  └── agent.iteration (iteration: 2)
      └── agent.model_call (model: claude-sonnet-4-6, 230ms)
```

### Trace Record Fields

| Field | Description |
|-------|-------------|
| `type` | Always `"span"` |
| `timestamp` | ISO 8601 completion time |
| `traceId` | Correlates all spans in one agent run |
| `spanId` | Unique span identifier |
| `parentSpanId` | Parent span (absent for root) |
| `name` | Span name (`agent.loop`, `agent.iteration`, `agent.model_call`, `agent.tool_execution`) |
| `durationMs` | Execution time in milliseconds |
| `status` | `ok` or `error` |
| `attributes` | Contextual data (tokens, tool names, etc.) |
| `events` | Span events (if any) |

## Visualizing with Open Source Tools

### Quick: jq (command line)

```bash
# Separate logs and traces into different files
RA_LOG_OUTPUT=file RA_LOG_FILE=./ra.log.jsonl \
  RA_TRACE_OUTPUT=file RA_TRACE_FILE=./ra.traces.jsonl \
  ra "do something"

# --- Working with LOGS ---

# Show all tool executions
cat ra.log.jsonl | jq 'select(.message == "executing tool" or .message == "tool execution complete")'

# Show all errors
cat ra.log.jsonl | jq 'select(.level == "error")'

# Step-by-step timeline
cat ra.log.jsonl | jq -r '"\(.timestamp) [\(.level)] \(.message)"'

# --- Working with TRACES ---

# Show trace tree with timing
cat ra.traces.jsonl | jq -r '"\(.durationMs)ms \(.name) [\(.status)]"'

# Find slow spans (>1s)
cat ra.traces.jsonl | jq 'select(.durationMs > 1000)'

# Reconstruct parent-child hierarchy
cat ra.traces.jsonl | jq -r 'if .parentSpanId then "  \(.name) \(.durationMs)ms" else "\(.name) \(.durationMs)ms" end'
```

### Grafana + Loki (logs) + Tempo (traces)

1. **Ship logs with Promtail:**
   ```yaml
   # promtail-config.yaml
   scrape_configs:
     - job_name: ra-logs
       static_configs:
         - targets: [localhost]
           labels:
             job: ra
             __path__: /var/log/ra/*.log.jsonl
       pipeline_stages:
         - json:
             expressions:
               level: level
               message: message
               sessionId: sessionId
         - labels:
             level:
             sessionId:
   ```

2. **Query logs in Grafana:**
   ```logql
   {job="ra"} | json | message="executing tool"
   {job="ra"} | json | level="error"
   {job="ra"} | json | message="agent loop complete" | unwrap outputTokens | sum by (sessionId)
   ```

### Jaeger (trace visualization)

Convert ra's trace records to Jaeger format:

```typescript
// scripts/export-traces.ts
const lines = (await Bun.file('ra.traces.jsonl').text()).trim().split('\n')
const spans = lines.map(l => JSON.parse(l)).filter(e => e.type === 'span').map(e => ({
  traceID: e.traceId,
  spanID: e.spanId,
  parentSpanID: e.parentSpanId || '',
  operationName: e.name,
  startTime: Math.round(new Date(e.timestamp).getTime() * 1000 - (e.durationMs * 1000)),
  duration: Math.round(e.durationMs * 1000),
  tags: Object.entries(e.attributes || {}).map(([k, v]) => ({
    key: k, type: typeof v === 'number' ? 'int64' : 'string', value: v,
  })),
  logs: (e.events || []).map((ev: any) => ({
    timestamp: Math.round(ev.timestamp * 1000),
    fields: [{ key: 'event', type: 'string', value: ev.name }],
  })),
  processID: 'ra',
  process: { serviceName: 'ra', tags: [] },
}))

await fetch('http://localhost:14268/api/traces', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: [{ traceID: spans[0]?.traceID, spans, processes: { ra: { serviceName: 'ra' } } }] }),
})
console.log('Sent', spans.length, 'spans to Jaeger')
```

```bash
docker run -d --name jaeger -p 16686:16686 -p 14268:14268 jaegertracing/all-in-one:latest
bun scripts/export-traces.ts
# Open http://localhost:16686 to view traces
```

### ELK Stack (Elasticsearch + Kibana)

```yaml
# filebeat.yml — ship logs
filebeat.inputs:
  - type: log
    paths: ["/var/log/ra/*.log.jsonl"]
    json:
      keys_under_root: true
      add_error_key: true
output.elasticsearch:
  hosts: ["localhost:9200"]
  index: "ra-logs-%{+yyyy.MM.dd}"
```

### OpenTelemetry Collector

Fan out logs and traces to multiple backends:

```yaml
# otel-collector-config.yaml
receivers:
  filelog/logs:
    include: [/var/log/ra/*.log.jsonl]
    operators:
      - type: json_parser
  filelog/traces:
    include: [/var/log/ra/*.traces.jsonl]
    operators:
      - type: json_parser

exporters:
  otlp:
    endpoint: "tempo:4317"
  loki:
    endpoint: "http://loki:3100/loki/api/v1/push"

service:
  pipelines:
    logs:
      receivers: [filelog/logs]
      exporters: [loki]
    traces:
      receivers: [filelog/traces]
      exporters: [otlp]
```

## Example: Full Debug Session

```bash
# Run with debug logging + traces to separate files
RA_LOG_LEVEL=debug RA_LOG_OUTPUT=file RA_LOG_FILE=./debug.log.jsonl \
  RA_TRACE_OUTPUT=file RA_TRACE_FILE=./debug.traces.jsonl \
  ra "list files in the current directory"

# View logs: what happened
cat debug.log.jsonl | jq -r '"\(.timestamp) [\(.level)] \(.message) \(del(.timestamp,.level,.message,.sessionId) | to_entries | map("\(.key)=\(.value)") | join(" "))"'

# View traces: where time was spent
cat debug.traces.jsonl | jq -r '
  (if .parentSpanId then "    " else "" end) +
  "\(.name) \(.durationMs)ms [\(.status)]"
'
```
