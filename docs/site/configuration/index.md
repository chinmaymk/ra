# Configuration Reference

ra uses a layered config system: **CLI > config file > defaults**. Each layer overrides the one to its right.

```
CLI flags > config file > defaults
```

Commit a `ra.config.yml` for a team or project baseline. Use `${VAR}` interpolation for secrets and per-environment settings. Use CLI flags for one-off overrides.

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

  providers:
    anthropic:
      apiKey: ${ANTHROPIC_API_KEY}    # resolved from env at load time

  storage:
    maxSessions: 100
    ttlDays: 30

  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN:-}"

agent:
  provider: ${PROVIDER:-anthropic}     # env override with default
  model: ${MODEL:-claude-sonnet-4-6}
  systemPrompt: You are a helpful coding assistant.
  maxIterations: 50
  thinking: adaptive
  toolTimeout: 30000

  skillDirs:
    - ./skills

  compaction:
    enabled: true
    threshold: 0.8
    model: claude-haiku-4-5-20251001

  context:
    enabled: true
    patterns:
      - "CLAUDE.md"
      - "AGENTS.md"

  tools:
    builtin: true
    # Per-tool overrides (optional)
    # Agent:
    #   maxConcurrency: 2

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
| `agent.maxIterations` | `--max-iterations` | `50` | Max agent loop iterations |
| `agent.thinking` | `--thinking` | `off` | Thinking mode: `off`, `low`, `medium`, `high`, `adaptive` |
| `agent.thinkingBudgetCap` | `--thinking-budget-cap` | — | Max thinking budget tokens (caps the level-based default) |
| `agent.toolTimeout` | — | `30000` | Per-tool and middleware timeout (ms) |
| `agent.tools.builtin` | `--tools-builtin` | `true` | Enable/disable [built-in tools](/tools/) |

### Agent — Permissions

Regex-based rules controlling what tools can do. See the [Permissions guide](/permissions/) for full details and examples.

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `agent.permissions.no_rules_rules` | — | `false` | Disable all permission checks |
| `agent.permissions.default_action` | — | `allow` | Action when no rule matches: `allow` or `deny` |
| `agent.permissions.rules` | — | `[]` | Array of per-tool regex rules |

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

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `agent.compaction.enabled` | — | `true` | Enable automatic context compaction |
| `agent.compaction.threshold` | — | `0.8` | Trigger at this fraction of context window |
| `agent.compaction.model` | — | provider default | Model for summarization |

### Agent — Context

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `agent.context.enabled` | — | `true` | Enable context file discovery |
| `agent.context.patterns` | — | `[]` | Glob patterns for context files |
| `agent.context.resolvers` | — | built-in | Pattern resolvers for `@file` and `url:` |

### Agent — Tools

The `agent.tools` section controls which built-in tools are registered and their per-tool settings. See [Built-in Tools](/tools/#configuring-tools) for full details.

```yaml
agent:
  tools:
    builtin: true            # master switch (default: true)
    Read:
      rootDir: "./src"        # constrain reads to this directory
    Write:
      rootDir: "./src"
    WebFetch:
      enabled: false          # disable a specific tool
    Agent:
      maxConcurrency: 2       # limit parallel subagent tasks
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent.tools.builtin` | boolean | `true` | Master switch: register all built-in tools unless individually disabled |
| `agent.tools.<ToolName>.enabled` | boolean | `true` | Enable or disable a specific tool |
| `agent.tools.<ToolName>.rootDir` | string | — | Restrict filesystem tools to this directory |
| `agent.tools.<ToolName>.maxConcurrency` | number | `4` | Max parallel tasks (Agent tool) |

### Agent — Subagent

The `Agent` tool forks parallel copies of the agent. Forks inherit the parent's model, system prompt, tools, thinking level, and `maxIterations`. Concurrency can be set via `agent.tools.Agent.maxConcurrency` (see above) or the top-level `agent.maxConcurrency` as a fallback.

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `agent.maxConcurrency` | — | `4` | Fallback max parallel subagent tasks (overridden by `agent.tools.Agent.maxConcurrency`) |

### App — Data directory

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `app.dataDir` | `--data-dir` | `.ra` | Root directory for all runtime data (sessions, memory, etc.) |

All runtime data is organized under `dataDir`: sessions in `{dataDir}/sessions/`, memory in `{dataDir}/memory.db`.

### App — Storage

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `app.storage.maxSessions` | `--storage-max-sessions` | `100` | Max sessions before auto-pruning |
| `app.storage.ttlDays` | `--storage-ttl-days` | `30` | Auto-expire sessions older than this |

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

| Field | CLI flag | Default | Description |
|-------|----------|---------|-------------|
| `app.mcpServers` | — | `[]` | External MCP servers to connect to |
| `app.mcpLazySchemas` | — | `true` | Lazy schema loading — register MCP tools with server-prefixed names and minimal schemas. First call to each tool returns the full schema; model retries with correct params. |

See [MCP](/modes/mcp#lazy-schema-loading) for details.

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
    agent:
      model: claude-haiku-4-5-20251001
      maxIterations: 5
```

| Field | Required | Description |
|-------|----------|-------------|
| `cron[].name` | yes | Human-readable job name (used in logs and traces) |
| `cron[].schedule` | yes | Standard cron expression |
| `cron[].prompt` | yes | Prompt sent to the agent on each run |
| `cron[].agent` | no | Per-job agent overrides (object) or path to a recipe YAML file (string) |

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
   --skill code-review \
   --file context.md \
   "Review this code"
```

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

Use `--show-config` to print the fully resolved configuration as JSON and exit. Useful for debugging config layering — shows the final result after merging defaults, config file, and CLI flags. Sensitive values (tokens, API keys) are redacted.

```bash
ra --show-config
ra --show-config --provider openai --model gpt-4.1
ra --show-context   # print discovered context files
```

## See also

- [Context Control](/core/context-control) — compaction, thinking, and pattern resolution details
- [Sessions](/core/sessions) — session storage and resume
- [Middleware](/middleware/) — middleware configuration
- [MCP](/modes/mcp) — MCP client and server configuration
