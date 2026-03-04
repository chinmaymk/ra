# Providers

ra works with any model from Anthropic, OpenAI, Azure OpenAI, Google Gemini, AWS Bedrock, or Ollama. Switch providers and models with a flag — the rest of your config stays the same.

```bash
ra --provider google --model gemini-2.5-pro "Summarize this doc"
ra --provider ollama --model llama3 "Write a haiku"
ra --provider bedrock --model anthropic.claude-sonnet-4-6 "Review this PR"
ra --provider azure --azure-deployment my-gpt4o "Explain this error"
```

Set your API key for the provider you want to use:

| Provider | Value | Key env var(s) |
|----------|-------|----------------|
| Anthropic | `anthropic` | `RA_ANTHROPIC_API_KEY` |
| OpenAI | `openai` | `RA_OPENAI_API_KEY` |
| Azure OpenAI | `azure` | `RA_AZURE_ENDPOINT`, `RA_AZURE_DEPLOYMENT` |
| Google Gemini | `google` | `RA_GOOGLE_API_KEY` |
| AWS Bedrock | `bedrock` | `RA_BEDROCK_REGION` |
| Ollama | `ollama` | `RA_OLLAMA_HOST` |

See the individual provider pages for setup and credential details.
