# Configuration Reference

ra uses a layered config system: **defaults → file → env → CLI**. Each layer overrides the previous.

```
defaults → config file → env vars → CLI flags
```

Commit a `ra.config.yml` for a team or project baseline. Use environment variables for secrets and per-environment settings. Use CLI flags for one-off overrides.

## Config file

Place in your project root. Supports JSON, YAML, or TOML.

- `ra.config.json`
- `ra.config.yaml` / `ra.config.yml`
- `ra.config.toml`

Full example:

```yaml
# ra.config.yml
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: You are a helpful coding assistant.
maxIterations: 50
thinking: medium
toolTimeout: 30000

skills:
  - code-review
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

storage:
  path: .ra/sessions
  maxSessions: 100
  ttlDays: 30

maxConcurrency: 4

middleware:
  beforeModelCall:
    - "./middleware/budget.ts"
  afterToolExecution:
    - "./middleware/audit.ts"

memory:
  enabled: true
  path: .ra/memory.db
  maxMemories: 1000
  ttlDays: 90
  injectLimit: 5

mcp:
  client:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@anthropic/mcp-filesystem"]
```

## All fields

### Core

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `provider` | `RA_PROVIDER` | `--provider` | `anthropic` | LLM provider |
| `model` | `RA_MODEL` | `--model` | provider default | Model name |
| `systemPrompt` | `RA_SYSTEM_PROMPT` | `--system-prompt` | — | System prompt text |
| `maxIterations` | `RA_MAX_ITERATIONS` | `--max-iterations` | `50` | Max agent loop iterations |
| `thinking` | `RA_THINKING` | `--thinking` | — | Extended thinking: `low`, `medium`, `high` |
| `toolTimeout` | — | — | `30000` | Per-tool and middleware timeout (ms) |
| `builtinTools` | `RA_BUILTIN_TOOLS` | `--no-builtin-tools` | `true` | Enable/disable [built-in tools](/tools/) |

### Skills

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `skills` | — | `--skill` | `[]` | Skills to activate (always-on) |
| `skillDirs` | — | — | `["./skills"]` | Directories to scan for skills |

### Compaction

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `compaction.enabled` | — | — | `true` | Enable automatic context compaction |
| `compaction.threshold` | — | — | `0.8` | Trigger at this fraction of context window |
| `compaction.model` | — | — | provider default | Model for summarization |

### Context

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `context.enabled` | — | — | `true` | Enable context file discovery |
| `context.patterns` | — | — | `[]` | Glob patterns for context files |
| `context.resolvers` | — | — | built-in | Pattern resolvers for `@file` and `url:` |

### Subagent

The `subagent` tool forks parallel copies of the agent. Forks inherit the parent's model, system prompt, tools, thinking level, and `maxIterations`.

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `maxConcurrency` | — | — | `4` | Max parallel subagent tasks per invocation |

### Storage

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `storage.path` | — | — | `.ra/sessions` | Session storage directory |
| `storage.maxSessions` | — | — | `100` | Max sessions before auto-pruning |
| `storage.ttlDays` | — | — | `30` | Auto-expire sessions older than this |

### Memory

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `memory.enabled` | `RA_MEMORY_ENABLED` | `--memory` | `false` | Enable persistent memory |
| `memory.path` | `RA_MEMORY_PATH` | — | `.ra/memory.db` | SQLite database path |
| `memory.maxMemories` | `RA_MEMORY_MAX_MEMORIES` | — | `1000` | Max stored memories (oldest trimmed) |
| `memory.ttlDays` | `RA_MEMORY_TTL_DAYS` | — | `90` | Auto-prune memories older than this |
| `memory.injectLimit` | `RA_MEMORY_INJECT_LIMIT` | — | `5` | Memories to inject as context per loop (0 to disable) |

### MCP

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `mcp.lazySchemas` | `RA_MCP_LAZY_SCHEMAS` | — | `true` | Lazy schema loading — register MCP tools with server-prefixed names and minimal schemas. First call to each tool returns the full schema; model retries with correct params. |

See [MCP](/modes/mcp/#lazy-schema-loading) for details.

### HTTP

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| — | — | `--http` | — | Start HTTP server |
| `http.port` | — | `--http-port` | `3000` | Server port |
| `http.token` | — | `--http-token` | — | Bearer token for authentication |

### Interface

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| — | — | `--interface` | auto | `cli`, `repl`, `http` |
| — | — | `--mcp-stdio` | — | Start as MCP server (stdio) |
| — | — | `--mcp` | — | Start as MCP server (HTTP) |
| — | — | `--resume` | — | Resume a previous session |
| — | — | `--file` | — | Attach files to the prompt |
| — | — | `--exec` | — | Run a script file |
| — | — | `--config` | — | Path to config file |

## Environment variables

```bash
# Provider
export RA_PROVIDER=anthropic
export RA_MODEL=claude-sonnet-4-6
export RA_SYSTEM_PROMPT="You are a helpful assistant"
export RA_MAX_ITERATIONS=50

# API keys (env-only — kept out of shell history)
export RA_ANTHROPIC_API_KEY=sk-...
export RA_OPENAI_API_KEY=sk-...
export RA_GOOGLE_API_KEY=...
export RA_OLLAMA_HOST=http://localhost:11434
export RA_BEDROCK_REGION=us-east-1

# Azure OpenAI (RA_AZURE_API_KEY optional — omit to use DefaultAzureCredential)
export RA_AZURE_ENDPOINT=https://myresource.openai.azure.com/
export RA_AZURE_DEPLOYMENT=my-gpt4o
export RA_AZURE_API_KEY=...
export RA_AZURE_API_VERSION=2024-12-01-preview
```

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

Credentials are env-only — never exposed as CLI flags to keep them out of shell history.

| Provider | Env var(s) | Docs |
|----------|-----------|------|
| Anthropic | `RA_ANTHROPIC_API_KEY`, `RA_ANTHROPIC_BASE_URL` | [Setup](/providers/anthropic) |
| OpenAI | `RA_OPENAI_API_KEY`, `RA_OPENAI_BASE_URL` | [Setup](/providers/openai) |
| Google | `RA_GOOGLE_API_KEY` | [Setup](/providers/google) |
| Azure | `RA_AZURE_ENDPOINT`, `RA_AZURE_DEPLOYMENT`, `RA_AZURE_API_KEY`, `RA_AZURE_API_VERSION` | [Setup](/providers/azure) |
| Bedrock | `RA_BEDROCK_API_KEY`, `RA_BEDROCK_REGION` | [Setup](/providers/bedrock) |
| Ollama | `RA_OLLAMA_HOST` | [Setup](/providers/ollama) |

## See also

- [Context Control](/core/context-control) — compaction, thinking, and pattern resolution details
- [Sessions](/core/sessions) — session storage and resume
- [Middleware](/middleware/) — middleware configuration
- [MCP](/modes/mcp) — MCP client and server configuration
