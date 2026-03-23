# Providers

A provider is an adapter that connects ra to a language model. It translates ra's internal message format into the API calls that each model vendor expects, and normalizes the streaming responses back into a common format.

ra ships with providers for:

| Provider | Models | Config key |
|----------|--------|------------|
| [Anthropic](/providers/anthropic) | Claude 4.5, Claude 4, Sonnet, Haiku | `anthropic` |
| [OpenAI](/providers/openai) | GPT-4.1, o3, o4-mini | `openai` |
| [Google](/providers/google) | Gemini 2.5 Pro, Flash | `google` |
| [AWS Bedrock](/providers/bedrock) | Claude via AWS | `bedrock` |
| [Azure OpenAI](/providers/azure) | GPT-4.1 via Azure | `azure` |
| [Ollama](/providers/ollama) | Llama, Mistral, local models | `ollama` |

## Switching providers

Change the provider with a flag:

```bash
ra --provider openai --model gpt-4.1 "Explain this error"
```

Or in config:

```yaml
agent:
  provider: openai
  model: gpt-4.1
```

The agent loop, tools, middleware, and skills all work the same regardless of which provider you pick. Only the model changes.

## How providers work

Every provider implements two methods:

- **`stream()`** — returns an async iterable of chunks (`text`, `thinking`, `tool_call_start`, `tool_call_delta`, `tool_call_end`, `done`)
- **`chat()`** — returns a complete response (used internally by some features like compaction summarization)

The streaming protocol ensures consistent behavior across vendors. Every stream ends with a `{ type: 'done' }` chunk that carries token usage data.

## Credentials

Each provider needs its own API key. Set them as environment variables or in your config:

```yaml
app:
  providers:
    anthropic:
      apiKey: ${ANTHROPIC_API_KEY}
    openai:
      apiKey: ${OPENAI_API_KEY}
```

Environment variables are interpolated at load time. See [Configuration](/configuration/) for the full syntax.

## Extended thinking

Some providers (Anthropic, OpenAI) support extended thinking — the model reasons through a problem before responding. ra surfaces thinking tokens in the stream so you can watch the model's reasoning in real time.

```yaml
agent:
  thinking: medium  # off, low, medium, high, adaptive
```

See [Context Control](/core/context-control) for more on thinking modes.
