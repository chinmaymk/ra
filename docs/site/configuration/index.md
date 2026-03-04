# Configuration Reference

ra uses a layered config system: **defaults → file → env → CLI**. Each layer overrides the previous.

## Config file

Place in your project root. Supports JSON, YAML, or TOML.

- `ra.config.json`
- `ra.config.yaml`
- `ra.config.yml`
- `ra.config.toml`

Full example:

```yaml
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: You are a helpful coding assistant.
maxIterations: 50
thinking: medium

skills:
  - code-review
skillDirs:
  - ./skills

storage:
  path: .ra/sessions
  maxSessions: 100
  ttlDays: 30

http:
  port: 3000
  token: my-secret-token

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
