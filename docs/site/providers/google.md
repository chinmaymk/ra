# Google Gemini

**Provider value:** `google`

## Setup

```bash
export RA_GOOGLE_API_KEY=AIza...
ra --provider google "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_GOOGLE_API_KEY` | Yes | Google AI API key |

## Models

| Model | Notes |
|-------|-------|
| `gemini-2.5-pro` | Most capable |
| `gemini-2.0-flash` | Fast and efficient |

## Thinking tokens

Supported levels: `low`, `medium`, `high`.

```bash
ra --provider google --model gemini-2.5-pro --thinking high "Reason through this carefully"
```
