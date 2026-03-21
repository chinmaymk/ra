# Multi-Agent Orchestrator

An orchestrator that dynamically creates persistent specialist agents as independent ra processes. The model decides when to spin up agents, what role each plays, and communicates with them over HTTP.

Each agent is a real ra instance with its own `ra.config.yaml`, system prompt, tools, skills, and conversation history.

## Prerequisites

- [ra](../../README.md) built (`bun run compile`)
- `RA_ANTHROPIC_API_KEY` set

## Quick Start

```bash
# Interactive mode
bun run ra --config recipes/multi-agent/ra.config.yaml

# One-shot mode
bun run ra --config recipes/multi-agent/ra.config.yaml \
  --interface cli \
  --prompt "Review src/ for security and performance issues using dedicated agents"
```

## How It Works

1. You describe a complex task
2. The orchestrator calls **CreateAgent** — writes a `ra.config.yaml`, spawns a new ra process with an HTTP interface
3. The orchestrator calls **MessageAgent** — sends messages to the agent and receives responses
4. The agent maintains conversation state across messages (iterative refinement)
5. When done, the orchestrator calls **DestroyAgent** to stop the process

```
Orchestrator
  ├── CreateAgent "security-auditor"
  │     → writes ra.config.yaml + skills
  │     → spawns ra --interface http
  │     → waits for HTTP server ready
  │
  ├── CreateAgent "perf-reviewer"
  │     → same process
  │
  ├── MessageAgent "security-auditor" → "Audit src/auth/"
  │     → POST /chat/sync → response
  │
  ├── MessageAgent "perf-reviewer" → "Profile src/data/"
  │     → POST /chat/sync → response
  │
  ├── MessageAgent "security-auditor" → "Check the fix I made"
  │     → conversation continues (same session)
  │
  ├── DestroyAgent "security-auditor"
  └── DestroyAgent "perf-reviewer"
```

## Available Tools

| Tool | Purpose |
|------|---------|
| `CreateAgent` | Spawn a new agent with name, system prompt, optional model/provider/skills |
| `MessageAgent` | Send a message to a running agent, get response |
| `ListAgents` | List running agents and their status |
| `DestroyAgent` | Stop and clean up an agent |

## Customization

### Model

```yaml
agent:
  model: claude-opus-4-6  # more capable orchestrator
```

### Max Agents

```yaml
agent:
  tools:
    overrides:
      CreateAgent:
        maxAgents: 6  # default 4
```

### Provider

Child agents default to the parent's provider and model. Override per-agent in the `CreateAgent` call:

```json
{
  "name": "fast-scanner",
  "instructions": "...",
  "model": "claude-haiku-4-5-20251001",
  "provider": "anthropic"
}
```
