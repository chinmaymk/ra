# Google Gemini

**Provider value:** `google`

## Setup

```bash
export GOOGLE_API_KEY=AIza...
ra --provider google "Hello"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Google AI API key (standard Google env var) |

## Models

| Model | Notes |
|-------|-------|
| `gemini-2.5-pro` | Most capable |
| `gemini-2.0-flash` | Fast and efficient. Used as default compaction model for Google |

```bash
ra --provider google --model gemini-2.5-pro "Design a system"
ra --provider google --model gemini-2.0-flash "Quick question"
```

## Extended thinking

Supported levels: `low`, `medium`, `high`.

```bash
ra --provider google --model gemini-2.5-pro --thinking high "Reason through this carefully"
```

## See also

- [Context Control](/core/context-control) — extended thinking and compaction details
- [Configuration](/configuration/) — provider credentials reference
