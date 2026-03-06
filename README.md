<h1 align="center">ra</h1>

<p align="center">
  <b>One loop. Infinite agents.</b><br>
  An extensible agentic loop you shape through config.
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#providers">Providers</a> &middot;
  <a href="#interfaces">Interfaces</a> &middot;
  <a href="#built-in-tools">Tools</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#mcp">MCP</a> &middot;
  <a href="#context-discovery">Context</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

---

**ra** is a complete agentic loop you configure into any agent you need.

Define behavior through skills and system prompts. Hook into every step — before the model call, after each tool result, on every stream chunk — with inline or file middleware. Connect any provider with a flag. Ship it as a one-shot CLI command, an interactive REPL, a streaming HTTP API, or an MCP server for Cursor and Claude Desktop. The config is the agent; change the config, change the agent.

```bash
# One-off question
ra "What is the capital of France?"

# Code review with a skill and file attachment
ra --skill code-review --file diff.patch "Review this diff"

# Custom persona via system prompt
ra --system-prompt "You are a concise technical writer" "Document this function"

# Use a different provider
ra --provider openai --model gpt-4.1 "Explain this error"

# Interactive session
ra
```

## Features

- **Batteries included** — 14 built-in tools for filesystem operations, shell execution, HTTP requests, and user interaction. The agent can read, write, search, and run commands out of the box — no setup required.
- **Extensible agentic loop** — A real model→tools→repeat loop with streaming, tool calling, and context compaction built in. Middleware hooks let you intercept every step — before the model call, after tool execution, on each stream chunk. Write hooks in TypeScript or JavaScript, inline or as files. Build guardrails, logging, or custom routing without forking anything.
- **Config-driven identity** — One binary becomes a code reviewer, a support bot, a CI agent, or anything else. Drop a `ra.config.yml` and the agent reshapes itself.
- **Provider portable** — Anthropic, OpenAI, Google, Bedrock, Ollama. Same config, any backend. Switch with a flag when one is down or slow.
- **Skills** — Package expertise into reusable bundles with instructions, scripts, and reference docs. Inject at runtime or wire always-on. Skills can include shell scripts in any language that run at activation and feed context to the model.
- **MCP in both directions** — Pull tools from external MCP servers *and* expose ra itself as a tool for Cursor, Claude Desktop, or your own agents. Give the model access to databases, file systems, or your own custom tools — all through config.
- **Multiple deployment modes** — CLI for scripts, REPL for conversations, HTTP for apps, MCP for agent-to-agent. One binary, every context.

## Why ra?

ra gives you full ownership of the agent loop.

Every message in and out, every tool call, every stream chunk — you can inspect it, modify it, or stop it. Middleware hooks run at every step. The full conversation history is always available to your hooks. Context compaction is built in and configurable. You decide what the model sees and when.

On top of that control sits everything you need to build real agents: skills for reusable behavior, MCP for tool connectivity, layered config for environment-specific tuning, and multiple interfaces so the same agent works in a terminal, a product, or another agent's toolchain.

- **In a CI pipeline** — `ra --skill debugger --file test-output.log "Why is this test failing?"` reads the logs and explains the failure.
- **In a terminal** — `ra` opens an interactive REPL. Attach files, ask follow-ups, keep context across turns.
- **In a product** — `ra --http` serves a streaming API. POST a message, get SSE back.
- **In an editor** — `ra --mcp-stdio` exposes the full agent loop as a tool for Cursor or Claude Desktop.

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

ra works with any model from Anthropic, OpenAI, Azure OpenAI, Google Gemini, AWS Bedrock, or Ollama. Switch providers and models with a flag — the rest of your config stays the same.

```bash
ra --provider google --model gemini-2.5-pro "Summarize this doc"
ra --provider ollama --model llama3 "Write a haiku"
ra --provider bedrock --model anthropic.claude-sonnet-4-6 "Review this PR"
ra --provider azure --azure-deployment my-gpt4o "Explain this error"
```

Set your API key for the provider you want to use:

| Provider | Env vars |
|----------|---------|
| `anthropic` | `RA_ANTHROPIC_API_KEY` |
| `openai` | `RA_OPENAI_API_KEY` |
| `google` | `RA_GOOGLE_API_KEY` |
| `bedrock` | `RA_BEDROCK_REGION` |
| `ollama` | `RA_OLLAMA_HOST` |
| `azure` | `RA_AZURE_ENDPOINT`, `RA_AZURE_DEPLOYMENT`, `RA_AZURE_API_KEY` (optional), `RA_AZURE_API_VERSION` (optional) |

> Bedrock falls back to the standard AWS credential chain (`~/.aws/credentials`, IAM roles, etc.) when `RA_BEDROCK_API_KEY` is not set.

> Azure falls back to `DefaultAzureCredential` (covers managed identity, Azure CLI, environment variables) when `RA_AZURE_API_KEY` is not set.

## Interfaces

Each interface serves a different context. Same agent, different entry point.

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
ra --mcp-stdio    # stdio transport (for Cursor, Claude Desktop)
ra --mcp          # HTTP transport (default port 3001)
```

When you run `--mcp-stdio`, ra prints the JSON config snippet you need to paste into your MCP client config.

## Built-in Tools

ra ships with 14 built-in tools that give the agent filesystem access, shell execution, HTTP requests, and user interaction out of the box. Enabled by default.

| Category | Tools |
|----------|-------|
| **Filesystem** | `read_file`, `write_file`, `update_file`, `append_file`, `list_directory`, `search_files`, `glob_files`, `move_file`, `copy_file`, `delete_file` |
| **Shell** | `execute_bash` (macOS/Linux) or `execute_powershell` (Windows) |
| **Network** | `web_fetch` |
| **Agent** | `ask_user`, `checklist` |

Tools are self-describing — each includes a description and input schema so the model knows when and how to use them without any system prompt. The shell tool automatically includes the detected OS in its description.

The `checklist` tool dynamically updates its description to show remaining items, keeping the model aware of progress across turns.

To disable built-in tools:

```bash
ra --no-builtin-tools
# or
export RA_BUILTIN_TOOLS=false
```

When ra runs as an MCP server, all built-in tools (except `ask_user`) are automatically exposed as MCP tools.

See the [full tools reference](https://chinmaymk.github.io/ra/tools/) for parameters and examples.

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

Supported: `bash`, `python`, `typescript`, `javascript`, `go`. TypeScript and JavaScript scripts prefer Bun, falling back to Node then Deno.

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

Run `ra --mcp-stdio` and it exposes itself as a single MCP tool. Other apps call it with a prompt and get the full agent loop.

```json
{
  "mcpServers": {
    "ra": {
      "command": "ra",
      "args": ["--mcp-stdio"]
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

Each middleware is an `async (ctx) => void` function. Every context object has `stop()` and `signal`:

```ts
ctx.stop()          // halt the agent loop
ctx.signal.aborted  // check if already stopped
```

### Hooks and context shapes

| Hook | Context | Description |
|------|---------|-------------|
| `beforeLoopBegin` | `LoopContext` | Once at start |
| `beforeModelCall` | `ModelCallContext` | Before each LLM call |
| `onStreamChunk` | `StreamChunkContext` | Per streaming chunk |
| `afterModelResponse` | `ModelCallContext` | After model finishes |
| `beforeToolExecution` | `ToolExecutionContext` | Before each tool call |
| `afterToolExecution` | `ToolResultContext` | After each tool returns |
| `afterLoopIteration` | `LoopContext` | After each loop iteration |
| `afterLoopComplete` | `LoopContext` | After final iteration |
| `onError` | `ErrorContext` | On exceptions |

### Context types

**`LoopContext`** — available on all hooks via `ctx.loop` (or directly for loop-level hooks):

```ts
{
  messages: IMessage[]     // full conversation history
  iteration: number        // current loop iteration
  maxIterations: number
  sessionId: string
  stop(): void
  signal: AbortSignal
}
```

**`ModelCallContext`** — `beforeModelCall`, `afterModelResponse`:

```ts
{
  request: {               // the ChatRequest about to be sent
    model: string
    messages: IMessage[]
    tools?: ITool[]
    thinking?: 'low' | 'medium' | 'high'
  }
  loop: LoopContext
}
```

**`StreamChunkContext`** — `onStreamChunk`:

```ts
{
  chunk:
    | { type: 'text'; delta: string }
    | { type: 'thinking'; delta: string }
    | { type: 'tool_call_start'; id: string; name: string }
    | { type: 'tool_call_delta'; id: string; argsDelta: string }
    | { type: 'tool_call_end'; id: string }
    | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } }
  loop: LoopContext
}
```

**`ToolExecutionContext`** — `beforeToolExecution`:

```ts
{
  toolCall: { id: string; name: string; arguments: string }
  loop: LoopContext
}
```

**`ToolResultContext`** — `afterToolExecution`:

```ts
{
  toolCall: { id: string; name: string; arguments: string }
  result: { toolCallId: string; content: string; isError?: boolean }
  loop: LoopContext
}
```

**`ErrorContext`** — `onError`:

```ts
{
  error: Error
  phase: 'model_call' | 'tool_execution' | 'stream'
  loop: LoopContext
}
```

### File middleware

Export a default async function:

```ts
// middleware/log-tools.ts
export default async (ctx) => {
  console.log(`Tool ${ctx.toolCall.name} returned:`, ctx.result.content)
}
```

Inline expressions and file paths both support TypeScript and JavaScript.

## Configuration

Layered config, each overriding the previous. No surprise precedence.

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

# Azure OpenAI (RA_AZURE_API_KEY is optional — omit to use DefaultAzureCredential)
export RA_AZURE_ENDPOINT=https://myresource.openai.azure.com/
export RA_AZURE_DEPLOYMENT=my-gpt4o
export RA_AZURE_API_KEY=...
export RA_AZURE_API_VERSION=2024-12-01-preview
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

## Context Discovery

ra automatically discovers project context files and injects them into every conversation. Files like `CLAUDE.md`, `AGENTS.md`, `COPILOT.md`, `CONVENTIONS.md`, and `CURSORRULES` are loaded from your project root and sent as user messages before your prompt.

```yaml
# ra.config.yml
context:
  enabled: true   # default
  patterns:
    - "CLAUDE.md"
    - "AGENTS.md"
    - "CONVENTIONS.md"
    - "COPILOT.md"
    - "CURSORRULES"
    - ".cursorrules"
    - ".github/copilot-instructions.md"
```

Each discovered file becomes a user message wrapped in XML tags:

```xml
<context-file path="CLAUDE.md">
file contents here
</context-file>
```

Context files are injected once at the start of a conversation in all interfaces (CLI, REPL, HTTP).

### CLI flags and REPL commands

```bash
# Preview discovered context files without starting a session
ra --show-context
```

In the REPL, use `/context` to list discovered files for the current session.

## Architecture

```
src/
  index.ts              # Entry point
  agent/
    loop.ts             # Core agent loop (model → tools → repeat)
    tool-registry.ts    # Tool registration and dispatch
    middleware.ts       # Middleware chain execution
  providers/            # Anthropic, OpenAI, Azure OpenAI, Google, Ollama, Bedrock
  interfaces/           # CLI, REPL, HTTP, MCP server
  context/              # Context file discovery and injection
  config/               # Layered config system
  mcp/                  # MCP client + server
  skills/               # Skill loader, runner, types
  storage/              # JSONL session persistence
```

## Building from Source

```bash
bun install
bun run compile
```

Then move `dist/ra` somewhere on your `PATH`.

## License

MIT

---

<p align="center">
  <b>ra</b> — raw agent, role agent, run-anything agent.<br>
  One loop. Infinite agents.
</p>
