# Ollama

**Provider value:** `ollama`

Run models locally. No API key required.

## Setup

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3`
3. Run ra:

```bash
ra --provider ollama --model llama3 "Write a haiku"
```

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `RA_OLLAMA_HOST` | No | Ollama host (default: `http://localhost:11434`) |

## Remote Ollama

```bash
export RA_OLLAMA_HOST=http://my-server:11434
ra --provider ollama --model llama3 "Hello"
```
