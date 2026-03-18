# src/config/

Layered configuration system: CLI flags > env vars > config file.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | `RaConfig` interface — all configuration fields with types |
| `defaults.ts` | `defaultConfig` object — sensible defaults for every field |
| `index.ts` | `loadConfig()` — merges all layers, resolves paths |

## Config Hierarchy

Each layer overrides the previous:
```
--cli-flags > RA_* env vars > ra.config.{yml,json,toml}
```

## Key RaConfig Fields

| Field | Default | Purpose |
|-------|---------|---------|
| `provider` | `'anthropic'` | LLM backend |
| `model` | `'claude-sonnet-4-6'` | Model ID |
| `interface` | `'repl'` | Entry point: cli, repl, http, mcp |
| `dataDir` | `'.ra'` | Root directory for all runtime data (sessions, memory) |
| `maxIterations` | `50` | Loop iteration limit |
| `toolTimeout` | `30000` | Tool execution timeout (ms) |
| `tools.builtin` | `true` | Register built-in tools (master switch) |
| `tools.overrides` | `{}` | Per-tool settings (enabled, rootDir, maxConcurrency) |
| `maxConcurrency` | `4` | Parallel tool execution limit (fallback for Agent) |
| `compaction.enabled` | `true` | Auto-summarize old messages |
| `compaction.threshold` | `0.80` | Trigger compaction at 80% context window |
| `memory.enabled` | `false` | SQLite-backed persistent memory |
| `logsEnabled` | `true` | Enable session logs |
| `logLevel` | `'info'` | Minimum log level |
| `tracesEnabled` | `true` | Enable session traces |
| `skills` | `[]` | Active skill names |
| `skillDirs` | `[]` | Directories to scan for skills |

## Provider Options

Each provider has its own options block under `providers`:
```yaml
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
