# Multi-Agent Orchestrator

An orchestrator that dynamically creates persistent specialist agents as independent ra processes. The model writes `ra.config.yaml` files, runs them with `ra --cli`, and resumes conversations with `--resume` — no custom tools, no HTTP servers, just Write + Bash.

## Prerequisites

- [ra](../../README.md) built (`bun run compile`) and `ra` on PATH
- `RA_ANTHROPIC_API_KEY` set

## Quick Start

```bash
# Interactive mode
ra --config recipes/multi-agent/ra.config.yaml

# One-shot mode
ra --config recipes/multi-agent/ra.config.yaml \
  --cli "Review src/ for security and performance issues using dedicated agents"
```

## How It Works

The orchestrator skill teaches the model to use existing tools:

1. **Write** — creates `/tmp/ra-agents/<name>/ra.config.yaml` with a custom system prompt and model
2. **Bash** — runs `ra --cli "message"` to send the first message
3. **Bash** — runs `ra --cli "follow-up" --resume <sessionId>` to continue the conversation
4. **Bash** — `rm -rf` to clean up when done

```
Orchestrator (existing tools only)
  │
  ├── Write /tmp/ra-agents/security-auditor/ra.config.yaml
  ├── Bash: ra --config ... --cli "Audit src/auth/"
  │     → agent reads files, uses tools, prints response
  │
  ├── Write /tmp/ra-agents/perf-reviewer/ra.config.yaml
  ├── Bash: ra --config ... --cli "Profile src/data/"
  │
  │   (find sessionId from .ra/sessions/)
  ├── Bash: ra --config ... --cli "Check the fix" --resume <session>
  │     → agent resumes with full prior context
  │
  ├── Bash: rm -rf /tmp/ra-agents/security-auditor
  └── Bash: rm -rf /tmp/ra-agents/perf-reviewer
```

## Customization

### Orchestrator model

```yaml
agent:
  model: claude-sonnet-4-6
```

### Child agent models

The orchestrator chooses the model per-agent when writing the config. The skill encourages using cheaper models for lightweight tasks.
