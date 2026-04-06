# Codex (ChatGPT Subscription)

**Provider value:** `codex`

Use your ChatGPT Plus or Pro subscription to run ra agents instead of paying per-token API costs. This routes requests through OpenAI's Codex backend using your subscription credits.

::: tip
OpenAI sanctions third-party tool usage via their "Codex for Open Source" program. Tools like OpenClaw and OpenCode use the same mechanism.
:::

## Setup

### Step 1: Login

```bash
# Browser-based login (recommended)
ra login codex

# Headless/SSH environments
ra login codex --device-code
```

This opens a browser for OpenAI authentication. Tokens are saved to `~/.ra/codex-tokens.json`.

### Step 2: Run

```bash
ra --provider codex --model gpt-5.4 "Hello"
```

## Authentication flows

| Flow | Command | When to use |
|------|---------|-------------|
| PKCE (default) | `ra login codex` | Desktop/laptop with a browser |
| Device Code | `ra login codex --device-code` | SSH, Docker, headless servers |

Tokens refresh automatically. Re-run `ra login codex` if you get auth errors.

## Models

Available models depend on your ChatGPT subscription tier:

| Model | Plan |
|-------|------|
| `gpt-5.4` | Plus, Pro |
| `gpt-5.3-codex` | Pro |
| `o4-mini` | Plus, Pro |
| `o3` | Pro |

```bash
ra --provider codex --model o4-mini "Explain this error"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CODEX_ACCESS_TOKEN` | No | Override the stored OAuth token (e.g. for CI). If not set, ra uses the token from `ra login codex`. |

## Config file

```yaml
agent:
  provider: codex
  model: gpt-5.4
```

Or with an explicit token:

```yaml
app:
  providers:
    codex:
      accessToken: ${CODEX_ACCESS_TOKEN}

agent:
  provider: codex
  model: gpt-5.4
```

## How it works

1. `ra login codex` authenticates via OpenAI's OAuth (PKCE or device code flow)
2. The provider routes requests to `chatgpt.com/backend-api/codex/responses` — the same endpoint the official Codex CLI uses
3. Requests use the standard OpenAI Responses API format, so all ra features (tools, streaming, context) work normally
4. Usage draws from your ChatGPT subscription quota, not API billing

## Limitations

- Subscription rate limits apply (30-150 msgs/5hr on Plus, 300-1,500 on Pro)
- Extended thinking (`--thinking`) is stripped from requests — the Codex backend may not support it
- Cannot use `api.openai.com` with subscription tokens — they only work with the Codex backend

## See also

- [OpenAI provider](/providers/openai) — for API key-based access
- [Configuration](/configuration/) — provider credentials reference
