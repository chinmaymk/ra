# Configuration

In ra, the config _is_ the agent. Drop a `ra.config.yml` in a directory and that directory becomes a project-specific assistant. Change the config, change the agent — same binary, different behavior.

## Layered config

Configuration comes from four sources, each overriding the last:

```
defaults < recipe < config file < CLI flags
```

- **Defaults** — sensible starting values for everything
- **Recipe** — a pre-built agent configuration (optional)
- **Config file** — `ra.config.yaml`, `.json`, or `.toml` in your project
- **CLI flags** — `--provider`, `--model`, `--skill`, etc.

This means you can set a baseline in a config file and override specific values per invocation.

## Two sections

Every config has two top-level sections:

| Section | What it controls |
|---------|-----------------|
| **`agent`** | LLM behavior — provider, model, system prompt, tools, middleware, skills, permissions, thinking, iteration limits |
| **`app`** | Infrastructure — interface mode, data directory, MCP servers, storage, logging |

The `agent` section is what makes your agent _your_ agent. The `app` section is how it runs.

## Environment variable interpolation

Configs can reference environment variables so you never hardcode secrets:

```yaml
app:
  providers:
    anthropic:
      apiKey: ${ANTHROPIC_API_KEY}
    openai:
      apiKey: ${OPENAI_API_KEY:-sk-default}  # with fallback
```

Three forms: `${VAR}` (required), `${VAR:-default}` (default if unset or empty), `${VAR-default}` (default if unset).

## A minimal config

```yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  systemPrompt: You are a helpful coding assistant.
```

That's a working agent. Everything else — tools, middleware, skills, permissions — layers on top.

## A full config

```yaml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: adaptive
  maxIterations: 50
  maxTokenBudget: 500000
  parallelToolCalls: true

  systemPrompt: You are a senior engineer working on this codebase.

  context:
    patterns:
      - "CLAUDE.md"
      - "docs/architecture.md"

  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]

  middleware:
    beforeModelCall:
      - "./middleware/budget.ts"

  skillDirs:
    - ./skills

app:
  interface: repl
  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
```

See [Configuration reference](/configuration/) for every available field.
