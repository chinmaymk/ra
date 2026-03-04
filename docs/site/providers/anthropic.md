# Anthropic

**Provider value:** `anthropic` (default)

## Setup

```bash
export RA_ANTHROPIC_API_KEY=sk-ant-...
ra "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `RA_ANTHROPIC_BASE_URL` | No | Custom base URL (for proxies) |

## Models

| Model | Notes |
|-------|-------|
| `claude-sonnet-4-6` | Default. Best balance of speed and capability. |
| `claude-opus-4-6` | Most capable. |
| `claude-haiku-4-5-20251001` | Fastest, cheapest. |

## Thinking tokens

Enable extended thinking for deeper reasoning. Supported levels: `low`, `medium`, `high`.

```bash
ra --thinking high "Design a distributed cache"
ra --thinking medium "Review this architecture"
```

Or in config:

```yaml
provider: anthropic
thinking: medium
```
