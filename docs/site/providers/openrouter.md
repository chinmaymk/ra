# OpenRouter

**Provider value:** `openai-completions`

[OpenRouter](https://openrouter.ai) gives you access to hundreds of models from many providers through a single API. It uses an OpenAI-compatible endpoint, so ra connects via the `openai-completions` provider.

## Quick start

```bash
export OPENAI_API_KEY=sk-or-...   # your OpenRouter API key
ra --provider openai-completions \
  --openai-base-url https://openrouter.ai/api/v1 \
  --model anthropic/claude-sonnet-4 "Hello"
```

## Config file

```yaml
app:
  providers:
    openai-completions:
      baseURL: https://openrouter.ai/api/v1
      apiKey: ${OPENROUTER_API_KEY}

agent:
  provider: openai-completions
  model: anthropic/claude-sonnet-4
```

## Popular models

OpenRouter hosts models from many providers. A few examples:

| Model | Model ID |
|-------|----------|
| Claude Sonnet | `anthropic/claude-sonnet-4` |
| GPT-4.1 | `openai/gpt-4.1` |
| Gemini 2.5 Pro | `google/gemini-2.5-pro` |
| Llama 3 70B | `meta-llama/llama-3-70b-instruct` |
| DeepSeek R1 | `deepseek/deepseek-r1` |

See the full list at [openrouter.ai/models](https://openrouter.ai/models).

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | Your OpenRouter API key (set as `OPENAI_API_KEY` or in config) |

::: tip
OpenRouter uses the same `apiKey` field as other OpenAI-compatible services. You can either set `OPENAI_API_KEY` to your OpenRouter key, or use a separate `OPENROUTER_API_KEY` variable and reference it in your config file.
:::

## See also

- [OpenAI Completions](/providers/openai-completions) — the underlying provider
- [Configuration](/configuration/) — provider credentials reference
