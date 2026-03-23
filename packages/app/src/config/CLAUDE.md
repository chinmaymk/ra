# src/config/

Layered configuration system: CLI flags > config file > defaults.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | `RaConfig`, `AppConfig`, `AgentConfig` interfaces — all configuration fields with types |
| `defaults.ts` | `defaultConfig` object — sensible defaults for every field, with `${VAR:-default}` references for provider credentials |
| `index.ts` | `loadConfig()` — merges all layers, resolves paths, interpolates `${VAR}` references |

## Config Hierarchy

Each layer overrides the previous:
```
--cli-flags > ra.config.{yml,json,toml} > defaults
```

## Environment Variable Interpolation

Config files and defaults support Docker Compose–style `${VAR}` interpolation:
- `${VAR}` — required, errors if not set
- `${VAR:-default}` — use default if unset or empty
- `${VAR-default}` — use default if unset (empty string is kept)

After interpolation, string values are coerced to match expected types (number, boolean) based on the default config schema.

Provider credentials are resolved from standard env vars by default (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

## Config Sections

`RaConfig` has two top-level sections:

### `app` — Application settings (AppConfig)

Infrastructure, deployment, and observability. Recipes typically don't set these.

| Field | Default | Purpose |
|-------|---------|---------|
| `app.interface` | `'repl'` | Entry point: cli, repl, http, mcp |
| `app.dataDir` | `~/.ra/<handle>/` | Root directory for all runtime data (sessions, memory), centralized and namespaced by project |
| `app.configDir` | cwd | Directory containing the config file |
| `app.http` | `{ port: 3000, token: '' }` | HTTP server settings |
| `app.inspector` | `{ port: 3002 }` | Inspector server settings |
| `app.storage` | `{ maxSessions: 100, ttlDays: 30 }` | Session storage settings |
| `app.providers` | `{ anthropic: {...}, ... }` | Per-provider credentials and connection options |
| `app.mcpServers` | `[]` | External MCP servers to connect to |
| `app.mcpLazySchemas` | `true` | Register MCP tools with minimal schemas (saves tokens) |
| `app.raMcpServer` | `{ enabled: false, port: 3001, ... }` | Ra's own MCP server endpoint |
| `app.logsEnabled` | `true` | Enable session logs |
| `app.logLevel` | `'info'` | Minimum log level |
| `app.tracesEnabled` | `true` | Enable session traces |

### `agent` — Agent behavior and capabilities (AgentConfig)

Everything a recipe defines: brain, tools, skills, permissions.

| Field | Default | Purpose |
|-------|---------|---------|
| `agent.provider` | `'anthropic'` | Which provider to use (references `app.providers`) |
| `agent.model` | `'claude-sonnet-4-6'` | Model ID |
| `agent.thinking` | — | Extended thinking: low, medium, high |
| `agent.systemPrompt` | `'You are a helpful AI assistant.'` | System prompt |
| `agent.maxIterations` | `0` | Loop iteration limit (0 = unlimited) |
| `agent.maxRetries` | `3` | Retry limit for model calls |
| `agent.toolTimeout` | `120000` | Tool execution timeout (ms) |
| `agent.maxConcurrency` | `4` | Parallel subagent task limit |
| `agent.parallelToolCalls` | `true` | Execute tool calls concurrently |
| `agent.maxTokenBudget` | `0` | Max total tokens before stopping (0 = unlimited) |
| `agent.maxDuration` | `0` | Max wall-clock ms before stopping (0 = unlimited) |
| `agent.tools.builtin` | `true` | Register built-in tools (master switch) |
| `agent.tools.overrides` | `{}` | Per-tool settings |
| `agent.skillDirs` | `['.claude/skills', ...]` | Directories to scan for skills |
| `agent.permissions` | `{}` | Tool permission rules |
| `agent.middleware` | `{}` | Custom middleware hooks |
| `agent.context` | `{ enabled: true, ... }` | Context file discovery |
| `agent.compaction` | `{ enabled: true, threshold: 0.70 }` | Auto-summarize old messages |
| `agent.memory` | `{ enabled: false, ... }` | SQLite-backed persistent memory |

## Provider Options

Each provider has its own options block under `app.providers`. The agent selects which one to use via `agent.provider`. Defaults resolve standard env vars:
```yaml
app:
  providers:
    anthropic: { apiKey: "${ANTHROPIC_API_KEY:-}" }
    openai: { apiKey: "${OPENAI_API_KEY:-}" }
    google: { apiKey: "${GOOGLE_API_KEY:-}" }
    ollama: { host: "${OLLAMA_HOST:-http://localhost:11434}" }
    bedrock: { region: "${AWS_REGION:-us-east-1}" }
    azure: { endpoint: "${AZURE_OPENAI_ENDPOINT:-}", deployment: "${AZURE_OPENAI_DEPLOYMENT:-}", apiKey: "${AZURE_OPENAI_API_KEY:-}" }
agent:
  provider: anthropic
```
