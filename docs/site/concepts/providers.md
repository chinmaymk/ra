# Providers

ra supports five providers. All use the same interface — swap `RA_PROVIDER` and keep going.

| Provider | Value | Env Key | Thinking |
|----------|-------|---------|:--------:|
| Anthropic | `anthropic` | `RA_ANTHROPIC_API_KEY` | `low` / `medium` / `high` |
| OpenAI | `openai` | `RA_OPENAI_API_KEY` | `low` / `medium` / `high` |
| Google Gemini | `google` | `RA_GOOGLE_API_KEY` | `low` / `medium` / `high` |
| AWS Bedrock | `bedrock` | `RA_BEDROCK_API_KEY` + `RA_BEDROCK_REGION` | `low` / `medium` / `high` |
| Ollama | `ollama` | `RA_OLLAMA_HOST` | — |

```bash
# Switch providers on the fly
ra --provider google --model gemini-2.5-pro "Explain quantum computing"

# Use a local model
ra --provider ollama --model llama3 "Write a haiku"

# Enable extended thinking
ra --thinking high "Design a distributed cache"
```

See the individual provider pages for setup and credential details.
