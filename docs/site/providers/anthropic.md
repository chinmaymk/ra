# Anthropic

**Provider value:** `anthropic` (default)

Anthropic is the default provider. If no `--provider` flag is set, ra uses Anthropic.

## Setup

```bash
export RA_ANTHROPIC_API_KEY=sk-ant-...
ra "Hello"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_ANTHROPIC_API_KEY` | Yes | Anthropic API key |
| `RA_ANTHROPIC_BASE_URL` | No | Custom base URL (for proxies or compatible APIs) |

## Models

| Model | Notes |
|-------|-------|
| `claude-sonnet-4-6` | Default. Best balance of speed and capability |
| `claude-opus-4-6` | Most capable |
| `claude-haiku-4-5-20251001` | Fastest, cheapest. Used as default compaction model |

```bash
ra --model claude-opus-4-6 "Design a distributed system"
ra --model claude-haiku-4-5-20251001 "Quick summary of this file" --file data.csv
```

## Extended thinking

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

## Prompt caching

ra automatically applies cache hints to system prompts and tool definitions when using Anthropic. This reduces costs on multi-turn sessions without any configuration needed. Cached tokens are billed at a reduced rate — especially beneficial for sessions with large system prompts or many tools.

## Custom base URL

Point ra at an Anthropic-compatible API proxy:

```bash
export RA_ANTHROPIC_BASE_URL=https://my-proxy.example.com/v1
ra "Hello"
```

Or via CLI flag:

```bash
ra --anthropic-base-url https://my-proxy.example.com/v1 "Hello"
```

## See also

- [Providers overview](/concepts/) — switching between providers
- [Context Control](/core/context-control) — extended thinking and prompt caching details
- [Configuration](/configuration/) — provider credentials reference
