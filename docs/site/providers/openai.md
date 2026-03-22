# OpenAI

ra ships two OpenAI providers — one for the **Responses API** (default) and one for the **Chat Completions API**.

| Provider value | API | When to use |
|----------------|-----|-------------|
| `openai` | [Responses API](https://platform.openai.com/docs/api-reference/responses) | **Default.** Use with OpenAI directly. Supports native file inputs and structured streaming events. |
| `openai-completions` | [Chat Completions API](https://platform.openai.com/docs/api-reference/chat) | Use with **OpenAI-compatible services** (Together AI, Fireworks, Groq, etc.) or if you specifically need the Chat Completions endpoint. |

## Setup

```bash
export OPENAI_API_KEY=sk-...
ra --provider openai "Hello"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key (used by both providers) |

## Models

| Model | Notes |
|-------|-------|
| `gpt-4.1` | Flagship model |
| `gpt-4.1-mini` | Faster, cheaper |
| `o3` | Reasoning model |
| `o4-mini` | Reasoning, fast |

```bash
ra --provider openai --model gpt-4.1 "Explain this error"
ra --provider openai --model o3 "Solve this step by step"
```

## Extended thinking

Supported levels: `low`, `medium`, `high`. Works with both providers.

```bash
ra --provider openai --thinking high "Solve this step by step"
```

## OpenAI-compatible APIs (Chat Completions) {#compatible-apis}

Most OpenAI-compatible services (Together AI, Fireworks, Groq, etc.) implement the **Chat Completions** endpoint, not the Responses API. Use `openai-completions` for these:

```bash
# Together AI
export OPENAI_API_KEY=your-together-key
ra --provider openai-completions \
  --openai-base-url https://api.together.xyz/v1 \
  --model meta-llama/Llama-3-70b-chat-hf "Hello"

# Groq
export OPENAI_API_KEY=your-groq-key
ra --provider openai-completions \
  --openai-base-url https://api.groq.com/openai/v1 \
  --model llama-3.3-70b-versatile "Hello"

# Fireworks
export OPENAI_API_KEY=your-fireworks-key
ra --provider openai-completions \
  --openai-base-url https://api.fireworks.ai/inference/v1 \
  --model accounts/fireworks/models/llama-v3p1-70b-instruct "Hello"
```

Or in a config file:

```yaml
app:
  providers:
    openai-completions:
      baseUrl: https://api.together.xyz/v1
      apiKey: ${OPENAI_API_KEY}

agent:
  provider: openai-completions
  model: meta-llama/Llama-3-70b-chat-hf
```

::: tip
If you use `--provider openai` with a third-party base URL and get errors, switch to `openai-completions` — the service likely doesn't support the Responses API.
:::

## Custom base URL (Responses API)

If you're using a proxy or gateway that supports the OpenAI Responses API:

```bash
ra --provider openai --openai-base-url https://my-proxy.example.com/v1 "Hello"
```

## Choosing between the two providers

Use **`openai`** (Responses API) when:
- Calling OpenAI directly
- Using a proxy that forwards to OpenAI's Responses endpoint
- You need native file attachment support

Use **`openai-completions`** (Chat Completions API) when:
- Using a third-party OpenAI-compatible service (Together, Groq, Fireworks, etc.)
- Calling an OpenAI-compatible local server (vLLM, llama.cpp server, etc.)
- The endpoint only supports `/v1/chat/completions`

## See also

- [Context Control](/core/context-control) — extended thinking details
- [Configuration](/configuration/) — provider credentials reference
