# Ollama

**Provider value:** `ollama`

Run models locally with [Ollama](https://ollama.ai). No API key required.

## Setup

1. Install [Ollama](https://ollama.ai)
2. Pull a model: `ollama pull llama3`
3. Run ra:

```bash
ra --provider ollama --model llama3 "Write a haiku"
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OLLAMA_HOST` | No | Ollama host (default: `http://localhost:11434`) |

## Remote Ollama

Point ra at an Ollama instance running on another machine:

```bash
export OLLAMA_HOST=http://my-server:11434
ra --provider ollama --model llama3 "Hello"
```

Or via CLI flag:

```bash
ra --provider ollama --ollama-host http://my-server:11434 --model llama3 "Hello"
```

## See also

- [Configuration](/configuration/) — provider credentials reference
