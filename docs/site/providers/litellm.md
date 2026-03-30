# LiteLLM

**Provider value:** `openai-completions`

[LiteLLM](https://docs.litellm.ai) is a proxy that provides a unified OpenAI-compatible API in front of 100+ LLM providers. Run the LiteLLM proxy locally or on your infrastructure, then point ra at it using the `openai-completions` provider.

## Quick start

1. Start the LiteLLM proxy (see [LiteLLM docs](https://docs.litellm.ai/docs/simple_proxy)):

```bash
litellm --model claude-sonnet-4
```

2. Connect ra:

```bash
ra --provider openai-completions \
  --openai-base-url http://localhost:4000/v1 \
  --model claude-sonnet-4 "Hello"
```

## Config file

```yaml
app:
  providers:
    openai-completions:
      baseURL: http://localhost:4000/v1
      apiKey: ${LITELLM_API_KEY}

agent:
  provider: openai-completions
  model: claude-sonnet-4
```

## With an API key

If your LiteLLM proxy requires authentication:

```bash
export OPENAI_API_KEY=sk-your-litellm-key
ra --provider openai-completions \
  --openai-base-url http://localhost:4000/v1 \
  --model claude-sonnet-4 "Hello"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Depends | Required if LiteLLM proxy has auth enabled |

::: tip
LiteLLM passes model-specific credentials (Anthropic, OpenAI, etc.) through its own configuration — ra only needs to authenticate with the proxy itself.
:::

## Remote proxy

Point ra at a LiteLLM proxy running on another machine:

```yaml
app:
  providers:
    openai-completions:
      baseURL: https://litellm.your-company.com/v1
      apiKey: ${LITELLM_API_KEY}

agent:
  provider: openai-completions
  model: claude-sonnet-4
```

## See also

- [OpenAI Completions](/providers/openai-completions) — the underlying provider
- [Configuration](/configuration/) — provider credentials reference
