# src/config/

Layered configuration system: CLI flags > env vars > config file.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | `RaConfig`, `AppConfig`, `AgentConfig` interfaces — all configuration fields with types |
| `defaults.ts` | `defaultConfig` object — sensible defaults for every field |
| `index.ts` | `loadConfig()` — merges all layers, resolves paths |

## Config Hierarchy

Each layer overrides the previous:
```
--cli-flags > RA_* env vars > ra.config.{yml,json,toml}
```

## Config Sections

`RaConfig` has two top-level sections:

### `app` — Application settings (AppConfig)

| Field | Default | Purpose |
|-------|---------|---------|
| `app.interface` | `'repl'` | Entry point: cli, repl, http, mcp |
| `app.dataDir` | `'.ra'` | Root directory for all runtime data (sessions, memory) |
| `app.configDir` | cwd | Directory containing the config file |
| `app.http` | `{ port: 3000, token: '' }` | HTTP server settings |
| `app.inspector` | `{ port: 3002 }` | Inspector server settings |
| `app.storage` | `{ maxSessions: 100, ttlDays: 30 }` | Session storage settings |
| `app.skillDirs` | `['.claude/skills', ...]` | Directories to scan for skills |
| `app.skills` | `[]` | Active skill names |
| `app.mcp` | `{ client: [], server: {...} }` | MCP client/server config |
| `app.permissions` | `{}` | Tool permission rules |
| `app.logsEnabled` | `true` | Enable session logs |
| `app.logLevel` | `'info'` | Minimum log level |
| `app.tracesEnabled` | `true` | Enable session traces |

### `agent` — Agent behavior (AgentConfig)

| Field | Default | Purpose |
|-------|---------|---------|
| `agent.provider` | `'anthropic'` | LLM backend |
| `agent.model` | `'claude-sonnet-4-6'` | Model ID |
| `agent.thinking` | — | Extended thinking: low, medium, high |
| `agent.systemPrompt` | `'You are a helpful AI assistant.'` | System prompt |
| `agent.providers` | `{ anthropic: {...}, ... }` | Per-provider credentials |
| `agent.maxIterations` | `50` | Loop iteration limit |
| `agent.maxRetries` | `3` | Retry limit for model calls |
| `agent.toolTimeout` | `30000` | Tool execution timeout (ms) |
| `agent.maxConcurrency` | `4` | Parallel tool execution limit |
| `agent.tools.builtin` | `true` | Register built-in tools (master switch) |
| `agent.tools.overrides` | `{}` | Per-tool settings |
| `agent.middleware` | `{}` | Custom middleware hooks |
| `agent.context` | `{ enabled: true, ... }` | Context file discovery |
| `agent.compaction` | `{ enabled: true, threshold: 0.80 }` | Auto-summarize old messages |
| `agent.memory` | `{ enabled: false, ... }` | SQLite-backed persistent memory |

## Provider Options

Each provider has its own options block under `agent.providers`:
```yaml
agent:
  providers:
    anthropic: { apiKey: "" }
    openai: { apiKey: "" }
    google: { apiKey: "" }
    ollama: { host: "http://localhost:11434" }
    bedrock: { region: "us-east-1" }
    azure: { endpoint: "", deployment: "", apiKey: "" }
```

## Env Var Convention

All env vars are prefixed with `RA_`: `RA_PROVIDER`, `RA_MODEL`, `RA_ANTHROPIC_API_KEY`, etc.
