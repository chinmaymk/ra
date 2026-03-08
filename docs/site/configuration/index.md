# Configuration Reference

ra uses a layered config system: **defaults → file → env → CLI**. Each layer overrides the previous.

```
defaults → config file → env vars → CLI flags
```

Commit a `ra.config.yml` for a team or project baseline. Use environment variables for secrets and per-environment behavior. Use CLI flags for one-off overrides.

## Config file

Place in your project root. Supports JSON, YAML, or TOML.

- `ra.config.json`
- `ra.config.yaml`
- `ra.config.yml`
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

middleware:
  beforeModelCall:
    - "./middleware/budget.ts"
  afterToolExecution:
    - "./middleware/audit.ts"

mcp:
  client:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@anthropic/mcp-filesystem"]
```

## All fields

| Field | Env var | CLI flag | Default | Description |
|-------|---------|----------|---------|-------------|
| `provider` | `RA_PROVIDER` | `--provider` | `anthropic` | AI provider |
| `model` | `RA_MODEL` | `--model` | provider default | Model name |
| `systemPrompt` | `RA_SYSTEM_PROMPT` | `--system-prompt` | — | System prompt |
| `maxIterations` | `RA_MAX_ITERATIONS` | `--max-iterations` | `50` | Max agent loop iterations |
| `thinking` | `RA_THINKING` | `--thinking` | — | Thinking depth: `low`, `medium`, `high` |
| `toolTimeout` | — | — | `30000` | Per-tool timeout in milliseconds |
| `builtinTools` | `RA_BUILTIN_TOOLS` | `--no-builtin-tools` | `true` | Enable/disable built-in tools |

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

## Session storage

Conversations persist automatically under `.ra/sessions/`.

```yaml
storage:
  path: .ra/sessions      # where sessions are stored
  maxSessions: 100        # max sessions to keep
  ttlDays: 30             # auto-prune sessions older than this
```

## Compaction

```yaml
compaction:
  enabled: true               # enable automatic context compaction
  threshold: 0.8              # trigger at 80% of context window
  model: claude-haiku-4-5-20251001  # cheap model for summarization
```

See [Context Control](/core/context-control) for details.

## Context & pattern resolution

```yaml
context:
  enabled: true             # enable context file discovery
  patterns:                 # glob patterns for context files
    - "CLAUDE.md"
    - "AGENTS.md"
  resolvers:                # pattern resolvers for inline references
    - name: file            # @path — resolve file contents
      enabled: true
    - name: url             # url:https://... — fetch URL
      enabled: true
    - name: custom          # custom resolver from file
      enabled: true
      path: ./resolvers/my-resolver.ts
```

Built-in resolvers (`file` and `url`) are enabled by default. See [Context Control](/core/context-control) for usage.

## HTTP config

```yaml
http:
  port: 3000
  token: my-secret-token
```

Or via CLI flags: `--http-port 8080 --http-token secret`

## Provider credentials

Credentials are env-only — never exposed as CLI flags to keep them out of shell history.

| Provider | Env var(s) |
|----------|-----------|
| Anthropic | `RA_ANTHROPIC_API_KEY`, `RA_ANTHROPIC_BASE_URL` |
| OpenAI | `RA_OPENAI_API_KEY`, `RA_OPENAI_BASE_URL` |
| Google | `RA_GOOGLE_API_KEY` |
| Ollama | `RA_OLLAMA_HOST` |
| Bedrock | `RA_BEDROCK_API_KEY`, `RA_BEDROCK_REGION` |
| Azure | `RA_AZURE_ENDPOINT`, `RA_AZURE_DEPLOYMENT`, `RA_AZURE_API_KEY` (optional), `RA_AZURE_API_VERSION` (optional) |
