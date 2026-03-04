<h1 align="center">ra</h1>

<p align="center">
  <b>One binary. Any shape. Any model.</b><br>
  A configurable AI agent you shape through config — not code.
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#providers">Providers</a> &middot;
  <a href="#interfaces">Interfaces</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#mcp">MCP</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

---

**ra** is a **r**aw **a**gent. A **r**ole **a**gent. A **r**un-**a**nything **a**gent.

Drop a `ra.config.yml` in a repo and you have a project-specific assistant. Change an env var and you have a different provider. Pass `--skill` and you inject a new behavior. Run `--mcp` and it becomes a tool for Cursor or Claude Desktop. The binary never changes — only the config does.

```bash
# One-off question
ra "What is the capital of France?"

# Code review with a skill and file attachment
ra --skill code-review --file diff.patch "Review this diff"

# Use a different provider
ra --provider openai --model gpt-4.1 "Explain this error"

# Interactive session
ra
```

## Features

- **Config-driven identity** — One binary becomes a code reviewer, a support bot, a CI agent, or anything else. Drop a `ra.config.yml` and the agent reshapes itself.
- **Provider portable** — Anthropic, OpenAI, Google, Bedrock, Ollama. Same config, any backend. Switch with a flag when one is down or slow.
- **Skills** — Package expertise into reusable bundles with instructions, scripts, and reference docs. Inject at runtime or wire always-on.
- **MCP in both directions** — Pull tools from external MCP servers *and* expose ra itself as a tool for Cursor, Claude Desktop, or your own agents.
- **Four deployment modes** — CLI for scripts, REPL for conversations, HTTP for apps, MCP for agent-to-agent. One binary, every context.

## Why ra?

Most AI tools lock you into one shape. ra is the opposite — it becomes whatever you configure it to be:

- **Need a code reviewer?** Write a `ra.config.yml` with the right system prompt and skills.
- **Need a support bot?** Same binary, different config.
- **Rate-limited on Anthropic?** Flip `RA_PROVIDER=openai` and keep going.
- **Want to run locally?** Point it at Ollama. No code changes.

## Install

```bash
# Download and install
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash

# Or manually
mv ra /usr/local/bin/ra && chmod +x /usr/local/bin/ra

# Verify
ra --help
```

## Quick Start

Set your provider key and go:

```bash
export RA_ANTHROPIC_API_KEY="sk-..."

# One-shot — streams to stdout and exits
ra "Summarize the key points of this file" --file report.pdf

# Interactive REPL
ra

# HTTP API server
ra --http

# MCP server for Cursor / Claude Desktop
ra --mcp
```

## Providers

Anthropic, OpenAI, Google, Bedrock, Ollama — switch with a flag or env var. Same config, any backend.

| Provider | Env Key | Thinking Support |
|----------|---------|:---:|
| **Anthropic** | `RA_ANTHROPIC_API_KEY` | `low` / `medium` / `high` |
| **OpenAI** | `RA_OPENAI_API_KEY` | `low` / `medium` / `high` |
| **Google Gemini** | `RA_GOOGLE_API_KEY` | `low` / `medium` / `high` |
| **AWS Bedrock** | `RA_BEDROCK_API_KEY` + `RA_BEDROCK_REGION` | `low` / `medium` / `high` |
| **Ollama** | `RA_OLLAMA_HOST` | — |

```bash
# Switch providers on the fly
ra --provider google --model gemini-2.5-pro "Explain quantum computing"

# Use a local model
ra --provider ollama --model llama3 "Write a haiku"

# Enable extended thinking
ra --thinking high "Design a distributed cache"
```

> Bedrock falls back to the standard AWS credential chain (`~/.aws/credentials`, IAM roles, etc.) when `RA_BEDROCK_API_KEY` is not set.

## Interfaces

Four ways to run ra. Each serves a different context.

### CLI (one-shot)

Scriptable prompts that stream to stdout and exit. Pipe it, chain it, cron it.

```bash
ra "What's wrong with this code?" --file buggy.ts
ra --skill summarizer --file notes.md "Three bullet summary"
cat error.log | ra "Explain this error"
```

### REPL (interactive)

The default mode. Full conversational sessions with tool use, file attachments, and history.

```bash
ra
```

| Command | Description |
|---------|-------------|
| `/clear` | Clear history, start fresh |
| `/resume <id>` | Resume a previous session |
| `/skill <name>` | Inject a skill for the next message |
| `/attach <path>` | Attach a file to the next message |

### HTTP API

A lightweight server built on `Bun.serve()`.

```bash
ra --http                        # default port 3000
ra --http --http-port 8080       # custom port
ra --http --http-token secret    # with auth
```

| Endpoint | Description |
|----------|-------------|
| `POST /chat` | SSE stream — `data: {"type":"text","delta":"..."}` |
| `POST /chat/sync` | Blocking JSON — `{ "response": "..." }` |
| `GET /sessions` | List stored sessions |

### MCP Server

Expose ra as a tool that other apps can call.

```bash
ra --mcp          # stdio transport (for Cursor, Claude Desktop)
ra --mcp-http     # HTTP transport
```

ra prints the JSON config snippet you need to paste into your MCP client config.

## Skills

Skills are reusable instruction bundles — roles, behaviors, and assets packaged as directories.

```
skills/
  code-review/
    SKILL.md           # Frontmatter + instructions
    scripts/
      gather-diff.sh   # Runs at activation, output becomes context
    references/
      style-guide.md   # Injected as reference context
```

**SKILL.md** uses YAML frontmatter:

```yaml
---
name: code-review
description: Reviews code for bugs, style, and best practices
---

You are a senior code reviewer. Focus on:
- Correctness and edge cases
- Performance implications
- Naming and readability
```

Use skills from the CLI, REPL, or config:

```bash
# CLI
ra --skill code-review "Review the latest changes"

# REPL
/skill code-review

# Config (always-on)
# ra.config.yml
skills:
  - code-review
skillDirs:
  - ./skills
```

**Multi-runtime scripts** — skill scripts support shebang detection. Write them in any language:

```bash
#!/usr/bin/env python3
# scripts/analyze.py — automatically runs with python3
```

Supported: `bash`, `python`, `typescript`, `javascript`, `go`.

## MCP

ra speaks MCP in both directions.

### As a client

Connect ra to external MCP servers. Their tools become available to the model automatically.

```yaml
# ra.config.yml
mcp:
  client:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@anthropic/mcp-filesystem"]
    - name: database
      transport: sse
      url: http://localhost:8080/mcp
```

### As a server

Run `ra --mcp` and it exposes itself as a single MCP tool. Other apps call it with a prompt and get the full agent loop.

```json
{
  "mcpServers": {
    "ra": {
      "command": "ra",
      "args": ["--mcp"]
    }
  }
}
```

## Middleware

Lifecycle hooks that let you intercept and modify the agent loop. Define them inline or as file paths.

```yaml
# ra.config.yml
middleware:
  beforeModelCall:
    - "(ctx) => { console.log('Calling model...'); }"
  afterToolExecution:
    - "./middleware/log-tools.ts"
```

| Hook | When |
|------|------|
| `beforeLoopBegin` | Once at start |
| `beforeModelCall` | Before each LLM call |
| `onStreamChunk` | Per streaming chunk |
| `afterModelResponse` | After model finishes |
| `beforeToolExecution` | Before each tool call |
| `afterToolExecution` | After each tool returns |
| `afterLoopIteration` | After each loop iteration |
| `afterLoopComplete` | After final iteration |
| `onError` | On exceptions |

Any middleware can call `ctx.stop()` to halt the loop.

## Configuration

Four layers, each overriding the previous. No surprise precedence.

```
defaults → config file → env vars → CLI flags
```

### Config file

Place in your project root. Supports JSON, YAML, or TOML.

```yaml
# ra.config.yml
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: You are a helpful coding assistant.
maxIterations: 50
thinking: medium

skills:
  - code-review
skillDirs:
  - ./skills

storage:
  path: .ra/sessions
  maxSessions: 100
  ttlDays: 30

http:
  port: 3000
  token: my-secret-token

mcp:
  client:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@anthropic/mcp-filesystem"]
```

### Environment variables

```bash
# Provider
export RA_PROVIDER=anthropic
export RA_MODEL=claude-sonnet-4-6
export RA_SYSTEM_PROMPT="You are a helpful assistant"
export RA_MAX_ITERATIONS=50

# API keys (env-only — kept out of shell history)
export RA_ANTHROPIC_API_KEY=sk-...
export RA_OPENAI_API_KEY=sk-...
export RA_GOOGLE_API_KEY=...
export RA_OLLAMA_HOST=http://localhost:11434
export RA_BEDROCK_REGION=us-east-1
```

### CLI flags

```bash
ra --provider openai \
   --model gpt-4.1 \
   --system-prompt "Be concise" \
   --max-iterations 10 \
   --thinking high \
   --skill code-review \
   --file context.md \
   "Review this code"
```

## Session Storage

Conversations persist automatically under `.ra/sessions/`. Resume any session by ID.

```bash
# List sessions
ra --http  # GET /sessions

# Resume in REPL
ra
› /resume abc-123-def
```

Sessions auto-prune by TTL and max count.

## Architecture

```
src/
  index.ts              # Entry point
  agent/
    loop.ts             # Core agent loop (model → tools → repeat)
    tool-registry.ts    # Tool registration and dispatch
    middleware.ts       # Middleware chain execution
  providers/            # Anthropic, OpenAI, Google, Ollama, Bedrock
  interfaces/           # CLI, REPL, HTTP, MCP server
  config/               # Layered config system
  mcp/                  # MCP client + server
  skills/               # Skill loader, runner, types
  storage/              # JSONL session persistence
```

## Building from Source

```bash
# Install dependencies
bun install

# Run in development
bun run src/index.ts

# Run tests
bun test

# Build standalone binary
bun build src/index.ts --compile --target bun --outfile dist/ra
```

## License

MIT

---

<p align="center">
  <b>ra</b> — raw agent, role agent, run-anything agent.<br>
  One binary, any shape, any model.
</p>
