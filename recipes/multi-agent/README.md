# Multi-Agent Orchestrator

An orchestrator that dynamically creates persistent specialist agents as independent ra processes. The model writes `ra.config.yaml` files, spawns ra with Bash, and communicates via HTTP — no custom tools needed.

## Prerequisites

- [ra](../../README.md) built (`bun run compile`)
- `RA_ANTHROPIC_API_KEY` set

## Quick Start

```bash
# Interactive mode
bun run ra --config recipes/multi-agent/ra.config.yaml

# One-shot mode
bun run ra --config recipes/multi-agent/ra.config.yaml \
  --cli "Review src/ for security and performance issues using dedicated agents"
```

## How It Works

The orchestrator skill teaches the model to use existing tools to manage agents:

1. **Write** — creates `ra.config.yaml` with a custom system prompt, model, and skills
2. **Bash** — spawns `ra --interface http` as a background process, tracks the PID
3. **Bash (curl)** — sends messages to `POST /chat/sync`, receives responses
4. **Bash** — kills the process when done

```
Orchestrator (existing tools only)
  │
  ├── Write /tmp/ra-agents/security-auditor/ra.config.yaml
  ├── Bash: ra --config ... &  (spawns HTTP server on port 4801)
  │
  ├── Write /tmp/ra-agents/perf-reviewer/ra.config.yaml
  ├── Bash: ra --config ... &  (spawns HTTP server on port 4802)
  │
  ├── Bash: curl :4801/chat/sync → "Audit src/auth/"
  ├── Bash: curl :4802/chat/sync → "Profile src/data/"
  │
  ├── Bash: curl :4801/chat/sync (sessionId) → "Check the fix"
  │     (conversation continues — agent remembers prior context)
  │
  ├── Bash: kill $(cat .../security-auditor/pid)
  └── Bash: kill $(cat .../perf-reviewer/pid)
```

## Key Insight

No new tools are needed. The model already has Write, Bash, and the HTTP interface provides a clean API. The skill just teaches the pattern:

- **Config authoring** — what to put in `ra.config.yaml`
- **Process management** — spawn, track PID, health-check, kill
- **Communication** — `POST /chat/sync` with `sessionId` for conversation continuity
- **Skills** — write `SKILL.md` files to inject domain knowledge into child agents

## Customization

### Orchestrator model

Use a more capable model for the orchestrator to improve delegation decisions:

```yaml
agent:
  model: claude-sonnet-4-6
```

### Child agent models

The orchestrator chooses the model per-agent when writing the config. The skill encourages using cheaper models for lightweight tasks.
