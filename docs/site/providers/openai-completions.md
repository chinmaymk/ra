# OpenAI Completions

**Provider value:** `openai-completions`

Uses the [Chat Completions API](https://platform.openai.com/docs/api-reference/chat) (`POST /v1/chat/completions`). This is the right provider for **OpenAI-compatible services** like Together AI, Fireworks, Groq, vLLM, and llama.cpp.

For full details, see the [OpenAI provider page](/providers/openai).

## Quick start

```bash
export OPENAI_API_KEY=sk-...
ra --provider openai-completions --model gpt-4.1 "Hello"
```

## With OpenAI-compatible services

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

## When to use this instead of `openai`

The default `openai` provider uses the newer [Responses API](https://platform.openai.com/docs/api-reference/responses), which most third-party services don't support. If you're connecting to anything other than OpenAI directly, use `openai-completions`.

| Scenario | Provider |
|----------|----------|
| OpenAI directly | `openai` |
| Together AI, Groq, Fireworks | `openai-completions` |
| vLLM, llama.cpp, Ollama-compatible | `openai-completions` |
| OpenAI proxy/gateway (Responses API) | `openai` |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | API key for the service |

## Extended thinking

Supported levels: `low`, `medium`, `high` (if the model supports it).

```bash
ra --provider openai-completions --thinking high "Solve this step by step"
```

## See also

- [OpenAI (Responses API)](/providers/openai) — default OpenAI provider
- [Configuration](/configuration/) — provider credentials reference
