# AWS Bedrock

**Provider value:** `bedrock`

## Setup

**Option 1: AWS credential chain** (recommended)

ra uses the standard AWS credential chain:

1. `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars
2. `~/.aws/credentials` file
3. IAM instance roles

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=us-east-1
ra --provider bedrock "Hello"
```

**Option 2: Bearer token**

A bearer token can be set in a config file:

```yaml
app:
  providers:
    bedrock:
      apiKey: your-bearer-token
```

```bash
export AWS_REGION=us-east-1
ra --provider bedrock "Hello"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_REGION` | Yes | AWS region (e.g. `us-east-1`) |

## Models

Use the full Bedrock model ID:

```bash
ra --provider bedrock --model anthropic.claude-sonnet-4-6 "Triage this bug"
```

## Prompt caching

ra automatically adds `cachePoint` blocks to system prompts and the last user message when using Claude models on Bedrock. This caches the conversation prefix across iterations, reducing both cost and latency.

No configuration needed. Cache stats are tracked per-iteration and visible in session traces.

See [Context Control — Prompt caching](/core/context-control#prompt-caching) for details.

## Extended thinking

Supported levels: `low`, `medium`, `high`.

```bash
ra --provider bedrock --thinking medium "Analyze this architecture"
```

## See also

- [Context Control](/core/context-control) — extended thinking details
- [Configuration](/configuration/) — provider credentials reference
