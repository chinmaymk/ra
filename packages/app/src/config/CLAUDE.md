# src/config/

Layered configuration system: CLI flags > config file > recipe > defaults.

## Files

| File | Purpose |
|------|---------|
| `types.ts` | `RaConfig`, `AppConfig`, `AgentConfig` interfaces — all config fields + typed helpers (`toolOption`, `allToolOptions`) |
| `defaults.ts` | `defaultConfig` — sensible defaults for every field, with `${VAR:-default}` refs for provider credentials |
| `index.ts` | `loadConfig()` — merges layers, resolves paths, interpolates `${VAR}`, and rejects legacy shapes with migration hints |
| `manager.ts` | `ConfigManager` — hot-reload by tracking mtimes of config file and referenced files (middleware, prompts, custom tools) |

## Config Hierarchy

Each layer overrides the previous:
```
defaults < recipe < ra.config.{yml,json,toml} < CLI flags
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

Infrastructure, deployment, and observability. Recipes may NOT set these.

| Field | Default | Purpose |
|-------|---------|---------|
| `app.interface` | `'repl'` | Entry point: cli, repl, http, mcp, mcp-stdio, inspector, cron |
| `app.dataDir` | `~/.ra/<handle>/` | Root directory for all runtime data (sessions, memory) |
| `app.configDir` | cwd | Directory containing the config file (set at load time) |
| `app.hotReload` | `true` | Reload config and referenced files (prompts, tools, middleware) between loops |
| `app.http` | `{ port: 3000, token: '' }` | HTTP server settings |
| `app.inspector` | `{ port: 3002 }` | Inspector server settings |
| `app.storage` | `{ maxSessions: 100, ttlDays: 30 }` | Session storage |
| `app.providers` | `{ anthropic: {...}, ... }` | Per-provider credentials and connection options |
| `app.mcp.servers` | `[]` | External MCP servers to connect to |
| `app.mcp.lazySchemas` | `true` | Register MCP tools with minimal schemas (saves tokens) |
| `app.mcp.server` | `{ enabled: false, port: 3001, ... }` | Ra's own MCP server endpoint (exposes ra as an MCP tool) |
| `app.logsEnabled` | `true` | Enable session logs |
| `app.logLevel` | `'info'` | Minimum log level |
| `app.tracesEnabled` | `true` | Enable session traces |

### `agent` — Agent behavior and capabilities (AgentConfig)

Everything a recipe defines: brain, tools, skills, permissions.

| Field | Default | Purpose |
|-------|---------|---------|
| `agent.provider` | `'anthropic'` | Which provider to use (references `app.providers`) |
| `agent.model` | `'claude-sonnet-4-6'` | Model ID |
| `agent.thinking` | — | Extended thinking: low, medium, high, adaptive |
| `agent.systemPrompt` | `'You are a helpful AI assistant.'` | System prompt |
| `agent.maxIterations` | `0` | Loop iteration limit (0 = unlimited) |
| `agent.maxRetries` | `3` | Retry limit for model calls |
| `agent.toolTimeout` | `120000` | Tool execution timeout (ms) |
| `agent.maxConcurrency` | `4` | Fallback parallel subagent task limit (overridden by `agent.tools.Agent.maxConcurrency`) |
| `agent.parallelToolCalls` | `true` | Execute tool calls concurrently |
| `agent.maxTokenBudget` | `0` | Max total tokens before stopping (0 = unlimited) |
| `agent.maxDuration` | `0` | Max wall-clock ms before stopping (0 = unlimited) |
| `agent.tools.builtin` | `true` | Register built-in tools (master switch) |
| `agent.tools.custom` | `[]` | File paths to custom tool files (JS/TS/shell) |
| `agent.tools.maxResponseSize` | `25000` | Max chars per tool response |
| `agent.tools.<ToolName>` | — | Per-tool settings (see "Tools section" below) |
| `agent.skillDirs` | `['.claude/skills', ...]` | Directories to scan for skills |
| `agent.permissions` | `{}` | Tool permission rules (see "Permissions" below) |
| `agent.middleware` | `{}` | Custom middleware hook bindings |
| `agent.context` | `{ enabled: true, ... }` | Context file discovery |
| `agent.compaction` | `{ enabled: true, threshold: 0.9, strategy: 'truncate' }` | Drop/summarize old messages when the context fills |
| `agent.memory` | `{ enabled: false, ... }` | SQLite-backed persistent memory |
| `agent.recipe` | — | Recipe to use as base (owner/name or local path). Stripped after resolution. |

## Tools section

Per-tool settings sit directly under `tools`, alongside the reserved keys
`builtin`, `custom`, and `maxResponseSize`:

```yaml
agent:
  tools:
    builtin: true                 # master switch
    custom:                        # custom tool files
      - ./tools/deploy.ts
    maxResponseSize: 25000         # max chars per tool response
    Read: { rootDir: "./src" }     # per-tool settings
    WebFetch: { enabled: false }
    Agent: { maxConcurrency: 4, maxDepth: 2 }
```

To read per-tool settings in code, use the `toolOption()` helper from
`./types` — it safely pulls the `ToolSettings` object for a given tool
name out of the index-signature shape.

## Permissions

```yaml
agent:
  permissions:
    disabled: false                # when true, allow everything
    defaultAction: allow           # or 'deny'
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]
```

## Cron composition

When `app.interface` is `'cron'`, `cron[]` defines scheduled jobs. Each job
can customize the agent by pointing at a recipe, inlining overrides, or both:

```yaml
cron:
  - name: daily-report
    schedule: "0 9 * * 1-5"
    prompt: "Summarize yesterday's git activity"
    recipe: ./recipes/reporter     # optional: base agent config
    overrides:                      # optional: Partial<AgentConfig> merged on top
      model: claude-haiku-4-5-20251001
      maxIterations: 5
```

## Provider Options

Each provider has its own options block under `app.providers`. The agent
selects which one to use via `agent.provider`. Defaults resolve standard env
vars:

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

## Legacy shapes

The loader no longer silently migrates old configs. If your config still
uses any of these keys, the loader throws a `ConfigError` with a migration
hint. Update to the current shape:

| Legacy | Now |
|--------|-----|
| `tools.overrides.X` | `tools.X` (flat) |
| `permissions.no_rules_rules` | `permissions.disabled` |
| `permissions.default_action` | `permissions.defaultAction` |
| `agent.hotReload` | `app.hotReload` |
| `app.mcpServers` | `app.mcp.servers` |
| `app.mcpLazySchemas` | `app.mcp.lazySchemas` |
| `app.raMcpServer` / `app.mcpServer` | `app.mcp.server` |
| `agent.mcp.*` | `app.mcp.*` |
| `agent.builtinTools` | `agent.tools.builtin` |
| top-level flat keys (`provider:`, `model:`, etc) | under `agent:` / `app:` |
| `cron[].agent: string \| object` | `cron[].recipe` + `cron[].overrides` |
