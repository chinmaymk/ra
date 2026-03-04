# Providers

ra works with any model from Anthropic, OpenAI, Google Gemini, AWS Bedrock, or Ollama. Switch providers and models with a flag — the rest of your config stays the same.

```bash
ra --provider google --model gemini-2.5-pro "Summarize this doc"
ra --provider ollama --model llama3 "Write a haiku"
ra --provider bedrock --model anthropic.claude-sonnet-4-6 "Review this PR"
```

Set your API key for the provider you want to use:

| Provider | Value | Env Key |
|----------|-------|---------|
| Anthropic | `anthropic` | `RA_ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `RA_OPENAI_API_KEY` |
| Google Gemini | `google` | `RA_GOOGLE_API_KEY` |
| AWS Bedrock | `bedrock` | `RA_BEDROCK_REGION` |
| Ollama | `ollama` | `RA_OLLAMA_HOST` |

See the individual provider pages for setup and credential details.
