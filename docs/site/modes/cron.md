# Cron

Run agent jobs on a schedule. Define jobs in your config file with a name, cron expression, and prompt. Ra starts a scheduler that executes each job at the specified time, creating a fresh session per run.

```bash
ra --interface cron
```

## Configuration

Add a `cron` section to your config file:

```yaml
# ra.config.yml
cron:
  - name: daily-report
    schedule: "0 9 * * 1-5"
    prompt: "Generate a summary of yesterday's git activity"

  - name: health-check
    schedule: "*/30 * * * *"
    prompt: "Check the status of our API endpoints and report any issues"

  - name: weekly-review
    schedule: "0 10 * * 1"
    prompt: "Review open PRs and summarize their status"
    agent:
      model: claude-sonnet-4-6
      maxIterations: 20
```

Each job has:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Human-readable name (used in logs and traces) |
| `schedule` | yes | Standard cron expression (e.g. `"0 9 * * 1-5"`) |
| `prompt` | yes | The prompt sent to the agent on each run |
| `agent` | no | Per-job agent overrides (model, maxIterations, etc.) or path to a recipe YAML file |

## Per-job agent overrides

Each job inherits the base `agent` config. Use the `agent` field to override specific settings for a job:

```yaml
cron:
  - name: quick-check
    schedule: "*/10 * * * *"
    prompt: "Check for new errors in the logs"
    agent:
      model: claude-haiku-4-5-20251001    # use a faster model
      maxIterations: 5                     # limit iterations

  - name: deep-analysis
    schedule: "0 2 * * *"
    prompt: "Analyze codebase for security vulnerabilities"
    agent: recipes/security-audit.yaml     # load from a recipe file
```

When `agent` is a string, it's treated as a path to a recipe YAML file (relative to the config directory). When it's an object, it's merged with the base agent config.

## Run immediately

Use `--run-immediately` to execute all jobs once on startup before switching to the cron schedule. Useful for testing:

```bash
ra --interface cron --run-immediately
```

## Observability

Each cron job creates its own session, so logs and traces are isolated per execution. You'll find them in:

```
{dataDir}/sessions/{job-session-id}/
  meta.json
  messages.jsonl
  logs.jsonl
  traces.jsonl
```

The cron scheduler also emits app-level tracer spans and structured logs:

### Tracer spans

| Span | Description |
|------|-------------|
| `cron.scheduler` | Wraps the full scheduler lifecycle. Attributes: `jobCount`, `jobNames`, `jobsRun`, `jobsFailed`, `stoppedBySignal` |
| `cron.job` | Wraps each individual job execution. Attributes: `job`, `schedule`, `sessionId`, `iterations`, `inputTokens`, `outputTokens`, `messageCount` |

### Log events

| Message | Level | Data |
|---------|-------|------|
| `cron scheduler starting` | info | `jobCount`, `jobs` |
| `cron job scheduled` | info | `job`, `schedule`, `nextRun`, `hasAgentOverride` |
| `cron job starting` | info | `job`, `schedule` |
| `cron job executing` | info | `job`, `model`, `maxIterations`, `promptLength` |
| `cron job session created` | info | `job`, `sessionId` |
| `cron job completed` | info | `job`, `sessionId`, `iterations`, `inputTokens`, `outputTokens`, `messageCount` |
| `cron job failed` | error | `job`, `sessionId`, `error` |
| `cron job rescheduled` | info | `job`, `nextRun` |
| `cron scheduler stopped` | info | `jobsRun`, `jobsFailed` |

## Example: monitoring agent

```yaml
# ra.config.yml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  systemPrompt: |
    You are a monitoring agent. Check system health and report issues.
    Use the Bash tool to run diagnostic commands.
  tools:
    builtin: true

cron:
  - name: uptime-check
    schedule: "*/5 * * * *"
    prompt: "Run a health check on the API at localhost:8080/health and report the status"

  - name: log-analysis
    schedule: "0 * * * *"
    prompt: "Check the last hour of logs in /var/log/app.log for errors or warnings"

  - name: daily-summary
    schedule: "0 18 * * 1-5"
    prompt: "Summarize today's system health, errors, and any patterns you noticed"
    agent:
      model: claude-sonnet-4-6
      thinking: medium
```

```bash
ra --interface cron --config ra.config.yml
```

## See also

- [Configuration](/configuration/) — full config reference
- [Observability](/observability/) — logs and traces
- [Sessions](/core/sessions) — session storage
- [CLI](/modes/cli) — one-shot mode
