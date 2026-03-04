# OpenAI

**Provider value:** `openai`

## Setup

```bash
export RA_OPENAI_API_KEY=sk-...
ra --provider openai "Hello"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_OPENAI_API_KEY` | Yes | OpenAI API key |
| `RA_OPENAI_BASE_URL` | No | Custom base URL (OpenAI-compatible APIs) |

## Models

| Model | Notes |
|-------|-------|
| `gpt-4.1` | Flagship GPT-4.1 |
| `gpt-4.1-mini` | Faster, cheaper |
| `o3` | Reasoning model |
| `o4-mini` | Reasoning, fast |

## Thinking tokens

Supported levels: `low`, `medium`, `high`.

```bash
ra --provider openai --thinking high "Solve this step by step"
```

## OpenAI-compatible APIs

Point `RA_OPENAI_BASE_URL` at any OpenAI-compatible endpoint:

```bash
export RA_OPENAI_BASE_URL=https://api.together.xyz/v1
export RA_OPENAI_API_KEY=your-together-key
ra --provider openai --model meta-llama/Llama-3-70b-chat-hf "Hello"
```
