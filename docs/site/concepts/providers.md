# Providers

ra supports five providers. All use the same interface — swap `RA_PROVIDER` and keep going.

| Provider | Value | Notes |
|----------|-------|-------|
| Anthropic | `anthropic` | Default. Claude models. |
| OpenAI | `openai` | GPT and o-series models. Compatible base URLs. |
| Google Gemini | `google` | Gemini models. |
| Ollama | `ollama` | Local models. No API key required. |
| AWS Bedrock | `bedrock` | AWS-hosted models. Bearer token or AWS credential chain. |

See the individual provider pages for setup and credential details.
