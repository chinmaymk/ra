# Multi-Agent Orchestrator

An orchestrator agent that dynamically creates and invokes specialized sub-agents to handle complex tasks. The model decides when to fork agents, what role each agent plays, and how to synthesize their results.

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
  --prompt "Review src/ for security and performance issues"
```

## How It Works

1. You describe a complex task
2. The orchestrator decomposes it into independent sub-tasks
3. Each sub-task gets a purpose-built agent with a specialized `role` (system prompt)
4. Agents run in parallel, each with its own conversation and tool access
5. The orchestrator synthesizes agent outputs into a unified result

Each sub-agent inherits all built-in tools (file I/O, shell, search) but gets a custom system prompt that focuses it on a single area of expertise.

## Agent Tool

The `Agent` tool accepts a `tasks` array. Each task has:

- **`task`** — the work to perform (required)
- **`role`** — a system prompt that specializes the agent (optional, inherits parent prompt if omitted)

```json
{
  "tasks": [
    {
      "role": "You are a security auditor. Report vulnerabilities only.",
      "task": "Audit src/auth/ for injection and auth bypass risks."
    },
    {
      "role": "You are a test engineer. Write thorough unit tests.",
      "task": "Write tests for src/utils/parse.ts covering edge cases."
    }
  ]
}
```

## Customization

### Model

Edit `ra.config.yaml` to change the model:

```yaml
agent:
  model: claude-opus-4-6  # more capable orchestration
```

### Concurrency and Depth

```yaml
agent:
  tools:
    overrides:
      Agent:
        maxConcurrency: 6  # max parallel agents (default 4)
        maxDepth: 3        # max nesting depth (default 2)
```

### Add MCP Servers

Sub-agents inherit MCP tools registered on the parent:

```yaml
app:
  mcp:
    client:
      - name: github
        transport: stdio
        command: npx
        args: ["-y", "@modelcontextprotocol/server-github"]
        env:
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
```
