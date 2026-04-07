# src/config/

Layered configuration system. Each layer overrides the previous:

```
--cli-flags > ra.config.{yml,json,toml} > recipe > standard env vars + secrets > defaults
```

## Files

| File | Purpose |
|------|---------|
| `types.ts` | `RaConfig`, `AppConfig`, `AgentConfig` interfaces — all configuration fields with types |
| `defaults.ts` | `defaultConfig` object — plain TS, no `${VAR}` magic. Empty-string credential placeholders are filled by the env layer |
| `index.ts` | `loadConfig()` — merges all layers, resolves paths, validates the result |

## Provider Credentials & Secrets

Provider credentials (and connection options like `OLLAMA_HOST`, `AZURE_OPENAI_ENDPOINT`)
flow through three sources, in priority order:

1. **Real `process.env`** — `ANTHROPIC_API_KEY=sk-... ra ...` always wins
2. **Secrets store** — `~/.ra/secrets.json` (mode 0600), profile-aware:
   ```
   ra secrets set OPENAI_API_KEY sk-...           # default profile
   ra secrets set OPENAI_API_KEY sk-... --profile work
   ```
   Profile selection: `--profile <name>` > `RA_PROFILE` > `"default"`.
3. **Defaults** — empty placeholders that satisfy the SDK type signatures

The mapping between standard env var names (`ANTHROPIC_API_KEY`,
`OPENAI_BASE_URL`, `AWS_REGION`, ...) and nested config paths lives in
`interfaces/parse-args.ts` (`STANDARD_ENV` + `buildStandardEnvLayer`).
Both `parseArgs` and `loadConfig` consume that single mapping.

There is **no `${VAR}` interpolation in config files anymore.** Write
literal values; if you need an env var, set it in your shell or store
it via `ra secrets set`.

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
| `agent.tools.custom` | `[]` | File paths to custom tool files (JS/TS) |
| `agent.tools.overrides` | `{}` | Per-tool settings |
| `agent.skillDirs` | `['.claude/skills', ...]` | Directories to scan for skills |
| `agent.permissions` | `{}` | Tool permission rules |
| `agent.middleware` | `{}` | Custom middleware hooks |
| `agent.context` | `{ enabled: true, ... }` | Context file discovery |
| `agent.compaction` | `{ enabled: true, threshold: 0.90, strategy: 'truncate' }` | Drop old messages when context is full |
| `agent.memory` | `{ enabled: false, ... }` | SQLite-backed persistent memory |

## Provider Options

Each provider has its own options block under `app.providers`. The agent
selects which one to use via `agent.provider`. Credentials and connection
options come from standard env vars / the secrets store; you only need a
config-file entry if you want to override a non-credential setting:

```yaml
agent:
  provider: anthropic
# Optional — credentials are filled from ANTHROPIC_API_KEY env var or
# `ra secrets set ANTHROPIC_API_KEY ...`. Override only if you have to:
app:
  providers:
    ollama: { host: "http://my-ollama-host:11434" }
```
