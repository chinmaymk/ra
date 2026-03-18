# Inspector

A built-in web dashboard for debugging agent sessions. Launches alongside any interface and serves a single-page app that lets you browse sessions, inspect messages, view token usage, and trace every tool call the agent made.

```bash
ra --inspector                          # enable on default port 3002
ra --inspector --inspector-port 8080    # custom port
ra --inspector --http                   # works with any interface
```

Open `http://localhost:3002` in your browser.

## Views

### Session views

Select a session from the sidebar to see its data across five tabs:

| Tab | What it shows |
|-----|---------------|
| **Overview** | Stats dashboard — duration, iterations, token totals, tool call counts, per-iteration token bar chart, tool usage table |
| **Timeline** | Chronological event stream — model calls, tool executions, warnings, and errors merged into a single timeline |
| **Messages** | Full message history — user, assistant, system, and tool messages with collapsible thinking blocks |
| **Logs** | Structured log entries — timestamp, level, message, and metadata fields |
| **Traces** | Hierarchical span tree — OpenTelemetry-style view with duration, status, and attributes per span |

### Global views

| Tab | What it shows |
|-----|---------------|
| **Config** | Resolved configuration (API keys redacted) |
| **Context** | Discovered context files and glob patterns |
| **Middleware** | Active middleware hooks and registered functions |
| **Memory** | Browse, search, add, and delete persistent memories |

## Overview dashboard

The Overview tab aggregates trace data into an at-a-glance summary:

- **Stats cards** — total duration, iteration count, input/output/thinking tokens, tool calls, tool errors, message count, and loop status (ok/error)
- **Token chart** — horizontal bar per iteration showing input (blue), output (green), and thinking (purple) token usage relative to the most expensive iteration
- **Tool table** — every tool used in the session, sorted by call count, with error count and total/average execution time

> The Overview tab requires observability traces. If you see "No trace data available", enable tracing:
>
> ```yaml
> observability:
>   traces:
>     output: session
> ```

## Timeline

The Timeline tab merges two data sources into one chronological view:

1. **Trace spans** — `agent.loop`, `agent.iteration`, `agent.model_call`, `agent.tool_execution`
2. **Log entries** — only `warn` and `error` level entries (to keep the timeline focused)

Each event shows its timestamp, duration, and type. Events are color-coded:

- Blue — model calls
- Orange — tool executions
- Green — iterations
- Purple — loop start/end
- Red — errors

## Configuration

```yaml
inspector:
  port: 3002
```

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `inspector.port` | `RA_INSPECTOR_PORT` | `--inspector-port` | `3002` | Port for the inspector server |

The inspector is enabled with the `--inspector` flag. It runs as a side server alongside whatever interface you're using (CLI, REPL, HTTP, MCP).

## API endpoints

The inspector serves a JSON API that the dashboard consumes. You can also query it directly:

| Endpoint | Description |
|----------|-------------|
| `GET /api/sessions` | List all sessions (sorted newest first) |
| `GET /api/sessions/:id/stats` | Aggregated stats from traces |
| `GET /api/sessions/:id/timeline` | Chronological event stream |
| `GET /api/sessions/:id/messages` | Raw message history |
| `GET /api/sessions/:id/logs` | Structured log entries |
| `GET /api/sessions/:id/traces` | Raw trace spans |
| `GET /api/config` | Resolved config (keys redacted) |
| `GET /api/context` | Discovered context files |
| `GET /api/middleware` | Active middleware hooks |
| `GET /api/memory` | List or search memories |
| `POST /api/memory` | Create a memory |
| `DELETE /api/memory/:id` | Delete a memory |

## Example

```bash
# Start an interactive REPL with the inspector
ra --inspector

# In another terminal, query the API directly
curl http://localhost:3002/api/sessions | jq '.[0].id'
curl http://localhost:3002/api/sessions/SESSION_ID/stats | jq '.totalTokens'
```

## See also

- [Observability](/observability/) — traces and logs that feed the inspector
- [Sessions](/core/sessions/) — session persistence and storage
- [Configuration](/configuration/) — full config reference
