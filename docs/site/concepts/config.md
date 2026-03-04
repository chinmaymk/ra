# Layered Config

**defaults → file → env → CLI.** Each layer overrides the previous. No surprise precedence.

Commit a `ra.config.yml` for a team or project baseline. Use environment variables for secrets and per-environment behavior. Use CLI flags when you need a one-off override.

## Config file locations

ra searches the current directory for any of these files:

- `ra.config.json`
- `ra.config.yaml`
- `ra.config.yml`
- `ra.config.toml`

## Environment variables

| Variable | Description |
|----------|-------------|
| `RA_PROVIDER` | Provider name (`anthropic`, `openai`, `google`, `ollama`, `bedrock`) |
| `RA_MODEL` | Model name |
| `RA_SYSTEM_PROMPT` | System prompt string |
| `RA_MAX_ITERATIONS` | Max agent loop iterations |

```bash
export RA_PROVIDER=anthropic
export RA_MODEL=claude-sonnet-4-6
export RA_SYSTEM_PROMPT="You are a helpful assistant"
export RA_MAX_ITERATIONS=50
```

## Provider credentials (env only)

Credentials are never exposed as CLI flags to keep them out of shell history.

| Provider | Env var(s) |
|----------|-----------|
| Anthropic | `RA_ANTHROPIC_API_KEY`, `RA_ANTHROPIC_BASE_URL` |
| OpenAI | `RA_OPENAI_API_KEY`, `RA_OPENAI_BASE_URL` |
| Google | `RA_GOOGLE_API_KEY` |
| Ollama | `RA_OLLAMA_HOST` |
| Bedrock | `RA_BEDROCK_API_KEY`, `RA_BEDROCK_REGION` |

## Full config file example

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

## CLI flags

CLI flags override everything. Use them for one-off runs.

```bash
ra --provider openai --model gpt-4.1-mini "Your prompt"
```

See `ra --help` for the full list.
