# Configuration Reference

ra uses a layered config system: **CLI > config file > recipe > defaults**. Each layer overrides the one to its right.

```
CLI flags > config file > recipe > defaults
```

Commit a `ra.config.yml` for a team or project baseline. Use `${VAR}` interpolation for secrets and per-environment settings. Use CLI flags for one-off overrides. Use recipes to compose a pre-built agent.

## Config file

Place in your project root. Supports JSON, YAML, or TOML.

- `ra.config.json`
- `ra.config.yaml` / `ra.config.yml`
- `ra.config.toml`

Config is organized into two sections: `app` (application infrastructure) and `agent` (LLM behavior).

Full example:

```yaml
# ra.config.yml
app:
  dataDir: .ra              # root for all runtime data
  hotReload: true           # reload config & referenced files between loops

  providers:
    anthropic:
      apiKey: ${ANTHROPIC_API_KEY}    # resolved from env at load time

  storage:
    maxSessions: 100
    ttlDays: 30

  mcp:
    servers:
      - name: github
        transport: stdio
        command: npx
        args: ["-y", "@modelcontextprotocol/server-github"]
        env:
          GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN:-}"
    lazySchemas: true
    server:                 # ra as an MCP server (disabled by default)
      enabled: false
      port: 3001
      tool:
        name: ra
        description: Ra AI agent

agent:
  provider: ${PROVIDER:-anthropic}     # env override with default
  model: ${MODEL:-claude-sonnet-4-6}
  systemPrompt: You are a helpful coding assistant.
  maxIterations: 0               # 0 = unlimited
  thinking: adaptive
  toolTimeout: 120000
  parallelToolCalls: true       # run tool calls concurrently (default)
  maxTokenBudget: 0             # 0 = unlimited, or set e.g. 200000
  maxDuration: 0                # 0 = unlimited, or set e.g. 300000 (5 min)

  skillDirs:
    - ./skills

  compaction:
    enabled: true
    threshold: 0.90
    strategy: truncate           # or 'summarize'

  context:
    enabled: true
    patterns:
      - "CLAUDE.md"
      - "AGENTS.md"

  tools:
    builtin: true                 # master switch
    custom:                        # custom tool files
      - ./tools/deploy.ts
    maxResponseSize: 25000         # max chars per tool response
    # Per-tool settings sit directly under `tools`:
    Read: { rootDir: "./src" }
    WebFetch: { enabled: false }
    Agent: { maxConcurrency: 2 }

  middleware:
    beforeModelCall:
      - "./middleware/budget.ts"
    afterToolExecution:
      - "./middleware/audit.ts"

  memory:
    enabled: true
    maxMemories: 1000
    ttlDays: 90
    injectLimit: 5
```

## All fields

### Agent — Core

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `agent.provider` | `--provider` | `anthropic` | LLM provider |
| `agent.model` | `--model` | provider default | Model name |
| `agent.systemPrompt` | `--system-prompt` | — | System prompt text |
| `agent.maxIterations` | `--max-iterations` | `0` (unlimited) | Max agent loop iterations (0 = unlimited) |
| `agent.thinking` | `--thinking` | `off` | Thinking mode: `off`, `low`, `medium`, `high`, `adaptive` |
| `agent.thinkingBudgetCap` | `--thinking-budget-cap` | — | Max thinking budget tokens (caps the level-based default) |
| `agent.toolTimeout` | `--tool-timeout` | `120000` | Per-tool and middleware timeout (ms) |
| `agent.parallelToolCalls` | — | `true` | Execute tool calls in parallel when the model returns multiple |
| `agent.maxTokenBudget` | — | `0` | Max total tokens (input + output) before the loop stops. 0 = unlimited |
| `agent.maxDuration` | — | `0` | Max wall-clock duration (ms) before the loop stops. 0 = unlimited |
| `agent.tools.builtin` | `--tools-builtin` | `true` | Enable/disable [built-in tools](/tools/) |

### Agent — Permissions

Regex-based rules controlling what tools can do. See the [Permissions guide](/permissions/) for full details and examples.

| Field | Default | Description |
|-------|---------|-------------|
| `agent.permissions.disabled` | `false` | Skip all permission checks |
| `agent.permissions.defaultAction` | `allow` | Action when no rule matches: `allow` or `deny` |
| `agent.permissions.rules` | `[]` | Array of per-tool regex rules |

```yaml
agent:
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]
      - tool: Write
        path:
          allow: ["^src/", "^tests/"]
```

### Agent — Skills

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `agent.skillDirs` | `--skill-dir` | `['.claude/skills', ...]` | Directories to scan for skills |

### Agent — Compaction

| Field | Default | Description |
|-------|---------|-------------|
| `agent.compaction.enabled` | `true` | Enable automatic context compaction |
| `agent.compaction.threshold` | `0.90` | Trigger at this fraction of context window |
| `agent.compaction.strategy` | `'truncate'` | `'truncate'` drops old messages (free, cache-friendly); `'summarize'` calls a model with metadata enrichment |
| `agent.compaction.model` | provider default | Model for summarization (only used with `strategy: 'summarize'`) |
| `agent.compaction.prompt` | built-in | Custom summarization prompt |

### Agent — Context

| Field | Default | Description |
|-------|---------|-------------|
| `agent.context.enabled` | `true` | Enable context file discovery |
| `agent.context.patterns` | `['CLAUDE.md', 'AGENTS.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md']` | Glob patterns for context files |
| `agent.context.resolvers` | built-in | Pattern resolvers for `@file` and `url:` |

### Agent — Tools

Per-tool settings sit directly under `tools`, next to the reserved keys `builtin`, `custom`, and `maxResponseSize`. See [Built-in Tools](/tools/#configuring-tools) for the full list.

```yaml
agent:
  tools:
    builtin: true                  # master switch (default: true)
    maxResponseSize: 25000          # max chars per tool response
    custom:                          # load tools from files
      - "./tools/deploy.ts"
      - "./tools/db-query.ts"
      - "./tools/health-check.sh"  # shell scripts auto-detected
    # Per-tool settings — keyed by tool name
    Read: { rootDir: "./src" }      # constrain reads to this directory
    Write: { rootDir: "./src" }
    WebFetch: { enabled: false }    # disable a specific tool
    Agent: { maxConcurrency: 2 }    # limit parallel subagent tasks
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent.tools.builtin` | boolean | `true` | Master switch: register all built-in tools unless individually disabled |
| `agent.tools.custom` | string[] | `[]` | File paths to [custom tool](/tools/custom) files (JS/TS/shell scripts) |
| `agent.tools.maxResponseSize` | number | `25000` | Max characters per tool response |
| `agent.tools.<ToolName>.enabled` | boolean | `true` | Enable or disable a specific tool |
| `agent.tools.<ToolName>.rootDir` | string | — | Restrict filesystem tools to this directory |
| `agent.tools.<ToolName>.maxConcurrency` | number | `4` | Max parallel tasks (Agent tool) |

### Agent — Subagent

The `Agent` tool forks parallel copies of the agent. Forks inherit the parent's model, system prompt, tools, thinking level, and `maxIterations`. Concurrency can be set via `agent.tools.Agent.maxConcurrency` (see above) or the top-level `agent.maxConcurrency` as a fallback.

| Field | Default | Description |
|-------|---------|-------------|
| `agent.maxConcurrency` | `4` | Fallback max parallel subagent tasks |

### App — Data directory and hot reload

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `app.dataDir` | `--data-dir` | `~/.ra/<handle>` | Root directory for all runtime data (sessions, memory, etc.) |
| `app.hotReload` | — | `true` | [Hot-reload](/core/hot-reload) config and referenced files between loops |

All runtime data is organized under `dataDir`: sessions in `{dataDir}/sessions/`, memory in `{dataDir}/memory.db`.

### App — Storage

| Field | Default | Description |
|-------|---------|-------------|
| `app.storage.maxSessions` | `100` | Max sessions before auto-pruning |
| `app.storage.ttlDays` | `30` | Auto-expire sessions older than this |

### Agent — Memory

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `agent.memory.enabled` | `--memory` | `false` | Enable persistent memory |
| `agent.memory.maxMemories` | — | `1000` | Max stored memories (oldest trimmed) |
| `agent.memory.ttlDays` | — | `90` | Auto-prune memories older than this |
| `agent.memory.injectLimit` | — | `5` | Memories to inject as context per loop (0 to disable) |

### App — Observability

| Field | Default | Description |
|-------|---------|-------------|
| `app.logsEnabled` | `true` | Enable session logs |
| `app.logLevel` | `info` | Minimum log level: `debug`, `info`, `warn`, `error` |
| `app.tracesEnabled` | `true` | Enable session traces |

### App — MCP

All MCP configuration (both client and server) lives under `app.mcp`.

```yaml
app:
  mcp:
    servers:                       # external servers to connect to
      - name: github
        transport: stdio
        command: npx
        args: ["-y", "@modelcontextprotocol/server-github"]
    lazySchemas: true               # register MCP tools with minimal schemas
    server:                         # ra as an MCP server (disabled by default)
      enabled: false
      port: 3001
      tool:
        name: ra
        description: Ra AI agent
```

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `app.mcp.servers` | — | `[]` | External MCP servers to connect to |
| `app.mcp.lazySchemas` | — | `true` | Lazy schema loading — register MCP tools with minimal schemas |
| `app.mcp.server.enabled` | `--mcp-server-enabled` | `false` | Enable ra's MCP server endpoint |
| `app.mcp.server.port` | `--mcp-server-port` | `3001` | MCP server port |
| `app.mcp.server.tool.name` | `--mcp-server-tool-name` | `ra` | Tool name exposed to MCP clients |
| `app.mcp.server.tool.description` | `--mcp-server-tool-description` | `Ra AI agent` | Tool description exposed to MCP clients |

See [MCP](/modes/mcp) for full details.

### App — HTTP

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| — | `--http` | — | Start HTTP server |
| `app.http.port` | `--http-port` | `3000` | Server port |
| `app.http.token` | `--http-token` | — | Bearer token for authentication |

### Cron

Define scheduled agent jobs. Only used when `--interface cron`.

```yaml
cron:
  - name: daily-report
    schedule: "0 9 * * 1-5"
    prompt: "Summarize yesterday's git activity"
  - name: health-check
    schedule: "*/30 * * * *"
    prompt: "Check API health"
    # Compose per-job: load a recipe as base and/or inline overrides.
    recipe: ./recipes/reporter      # optional: base agent config
    overrides:                       # optional: merged on top
      model: claude-haiku-4-5-20251001
      maxIterations: 5
```

| Field | Required | Description |
|-------|----------|-------------|
| `cron[].name` | yes | Human-readable job name (used in logs and traces) |
| `cron[].schedule` | yes | Standard cron expression |
| `cron[].prompt` | yes | Prompt sent to the agent on each run |
| `cron[].recipe` | no | Recipe path or installed name used as base agent config |
| `cron[].overrides` | no | Inline `Partial<AgentConfig>` merged on top of the base |

See [Cron](/modes/cron) for details.

### App — Interface

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| — | `--interface` | auto | `cli`, `repl`, `http`, `cron` |
| — | `--mcp-stdio` | — | Start as MCP server (stdio) |
| — | `--mcp` | — | Start as MCP server (HTTP) |
| — | `--resume` | — | Resume the latest session (or `--resume=<id>` for a specific one) |
| — | `--file` | — | Attach files to the prompt |
| — | `--exec` | — | Run a script file |
| — | `--show-config` | — | Show resolved configuration and exit |
| — | `--config` | — | Path to config file |
| — | `--recipe` | — | Load a recipe as the base agent config |

## Environment variable interpolation

Config files and defaults support Docker Compose–style `${VAR}` interpolation. Three forms are supported:

| Syntax | Behavior |
|--------|----------|
| `${VAR}` | **Required** — errors if not set |
| `${VAR:-default}` | Use default if unset **or** empty |
| `${VAR-default}` | Use default if unset (empty string is kept) |

Interpolation runs on both the config file and the built-in defaults, so standard provider env vars work out of the box:

```bash
# These are resolved by the defaults — no config file needed
export ANTHROPIC_API_KEY=sk-...
export OPENAI_API_KEY=sk-...
export GOOGLE_API_KEY=...
export OLLAMA_HOST=http://localhost:11434
export AWS_REGION=us-east-1
export AZURE_OPENAI_ENDPOINT=https://myresource.openai.azure.com/
export AZURE_OPENAI_DEPLOYMENT=my-gpt4o
export AZURE_OPENAI_API_KEY=...
```

To make any config field env-driven, use `${}` in your config file:

```yaml
agent:
  provider: ${PROVIDER:-anthropic}
  model: ${MODEL:-claude-sonnet-4-6}
  maxIterations: ${MAX_ITERS:-50}     # coerced to number automatically
app:
  http:
    token: ${HTTP_TOKEN:-}
```

String values produced by `${}` are automatically coerced to match the expected type (number, boolean) based on the schema.

## CLI flags

CLI flags override everything. Use them for one-off runs.

```bash
ra --provider openai \
   --model gpt-4.1 \
   --system-prompt "Be concise" \
   --max-iterations 10 \
   --thinking high \
   --skill-dir ./my-skills \
   --file context.md \
   "Review this code"
```

ra only exposes CLI flags for the most-used fields. Everything else lives in the config file.

## Provider credentials

Provider API keys are resolved from standard environment variables by default. No `RA_` prefix needed.

| Provider | Env var(s) | Docs |
|----------|-----------|------|
| Anthropic | `ANTHROPIC_API_KEY` | [Setup](/providers/anthropic) |
| OpenAI | `OPENAI_API_KEY` | [Setup](/providers/openai) |
| Google | `GOOGLE_API_KEY` | [Setup](/providers/google) |
| Azure | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_KEY` | [Setup](/providers/azure) |
| Bedrock | `AWS_REGION` | [Setup](/providers/bedrock) |
| Ollama | `OLLAMA_HOST` | [Setup](/providers/ollama) |

## Inspect

Use `--show-config` to print the fully resolved configuration as JSON and exit. Useful for debugging config layering — shows the final result after merging defaults, recipe, config file, and CLI flags. Sensitive values (tokens, API keys) are redacted.

```bash
ra --show-config
ra --show-config --provider openai --model gpt-4.1
ra --show-context   # print discovered context files
```

## Migrating from older configs

The loader no longer silently migrates legacy shapes. If you see a
`ConfigError` with a migration hint at startup, update your config to the
current shape:

| Legacy | Now |
|--------|-----|
| `agent.tools.overrides.X` | `agent.tools.X` (flat, alongside `builtin`/`custom`/`maxResponseSize`) |
| `agent.permissions.no_rules_rules` | `agent.permissions.disabled` |
| `agent.permissions.default_action` | `agent.permissions.defaultAction` |
| `agent.hotReload` | `app.hotReload` |
| `app.mcpServers` | `app.mcp.servers` |
| `app.mcpLazySchemas` | `app.mcp.lazySchemas` |
| `app.raMcpServer` / `app.mcpServer` | `app.mcp.server` |
| `agent.mcp.*` | `app.mcp.*` |
| `agent.builtinTools` | `agent.tools.builtin` |
| top-level flat keys (`provider:`, `model:`, etc) | under `agent:` / `app:` |
| `cron[].agent: string \| object` | `cron[].recipe` + `cron[].overrides` |

## See also

- [Context Control](/core/context-control) — compaction, thinking, and pattern resolution details
- [Sessions](/core/sessions) — session storage and resume
- [Middleware](/middleware/) — middleware configuration
- [MCP](/modes/mcp) — MCP client and server configuration
