<h1 align="center">ra</h1>

<p align="center">
  <b>One Loop. Infinite Agents.</b><br>
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#context-control">Context Control</a> &middot;
  <a href="#providers">Providers</a> &middot;
  <a href="#interfaces">Interfaces</a> &middot;
  <a href="#built-in-tools">Tools</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#mcp">MCP</a> &middot;
  <a href="#middleware">Middleware</a> &middot;
  <a href="#recipes">Recipes</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

---

Every message, every tool call, every stream chunk — visible and interceptable. Start with a config file and add code only where you need it. One binary becomes a CLI tool, an interactive REPL, a streaming HTTP API, or an MCP server.

```bash
ra "What is the capital of France?"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --skill code-review --file diff.patch "Review this diff"
ra   # interactive REPL
```

## Why ra

**You're building an agent and you need control over the context window.**

Other frameworks give you high-level abstractions that hide the conversation. ra exposes it. You can hook in before the model call, after each tool result, on every stream chunk — and every hook gets the full message history, so you can inspect, mutate, or halt the conversation at any point. Config handles the common cases; code handles the rest.

- **Guardrails** — Reject tool calls, redact PII, enforce token budgets, all in middleware.
- **Observability** — Log every model request and response. See exactly what the model saw and why it made that tool call.
- **Context management** — Token tracking per iteration, automatic compaction with a cheap model, pinned system messages that never get summarized away.
- **Multiple surfaces** — Same agent config runs as a CLI command in CI, a REPL for developers, a streaming API for your product, or an MCP tool inside Cursor.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
ra --help
```

## Quick Start

```bash
export RA_ANTHROPIC_API_KEY="sk-..."

ra "Summarize the key points of this file" --file report.pdf   # one-shot
ra                                                              # interactive REPL
ra --http                                                       # HTTP API
ra --mcp                                                        # MCP server
```

## Context Control

This is what separates ra from everything else. You have full, programmatic control over the context window at every stage of the loop.

### Middleware hooks

Intercept the loop before the model call, after tool execution, on each stream chunk — or anywhere in between. Every hook receives the full conversation history and can mutate it.

```yaml
# ra.config.yml
middleware:
  beforeModelCall:
    - "./middleware/enforce-budget.ts"
  afterToolExecution:
    - "./middleware/redact-secrets.ts"
  onStreamChunk:
    - "(ctx) => { process.stdout.write(ctx.chunk.type === 'text' ? ctx.chunk.delta : '') }"
```

```ts
// middleware/enforce-budget.ts — reject if context is too large
export default async (ctx) => {
  const totalChars = ctx.request.messages.reduce((n, m) => n + JSON.stringify(m).length, 0)
  if (totalChars > 500_000) ctx.stop()
}
```

### Smart context compaction

When conversations grow, ra compacts automatically. It splits the history into three zones — pinned messages (system prompt, first user message), compactable middle, and recent turns — then summarizes the middle with a cheap model. You keep the context that matters.

```yaml
compaction:
  model: claude-haiku-4-5-20251001  # cheap model for summarization
```

- **Token-aware** — Uses real token counts from the provider when available, falls back to estimation.
- **Pinned zones** — System prompts and initial context never get compacted.
- **Configurable threshold** — Triggers when the conversation reaches a percentage of the model's context window.
- **Provider-portable** — Works the same across all providers.

### Token tracking

ra tracks input and output tokens across every iteration of the loop. Your middleware can read cumulative usage and enforce budgets, log costs, or trigger compaction early.

### Prompt caching

Automatic cache hints on system prompts and tool definitions for Anthropic, reducing costs on multi-turn sessions without any config.

### Context discovery

ra auto-discovers project context files — `CLAUDE.md`, `AGENTS.md`, `COPILOT.md`, `CONVENTIONS.md`, `CURSORRULES` — and injects them into the conversation before your prompt.

```bash
ra --show-context  # preview what gets injected
```

## Providers

Same config, any backend. Switch with a flag.

```bash
ra --provider anthropic --model claude-sonnet-4-6 "Review this PR"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --provider google --model gemini-2.5-pro "Summarize this doc"
ra --provider ollama --model llama3 "Write a haiku"
ra --provider bedrock --model anthropic.claude-sonnet-4-6 "Triage this bug"
ra --provider azure --azure-deployment my-gpt4o "Analyze this log"
```

| Provider | Env vars |
|----------|---------|
| `anthropic` | `RA_ANTHROPIC_API_KEY` |
| `openai` | `RA_OPENAI_API_KEY` |
| `google` | `RA_GOOGLE_API_KEY` |
| `bedrock` | `RA_BEDROCK_REGION` |
| `ollama` | `RA_OLLAMA_HOST` |
| `azure` | `RA_AZURE_ENDPOINT`, `RA_AZURE_DEPLOYMENT`, `RA_AZURE_API_KEY` (optional) |

> Bedrock falls back to the standard AWS credential chain. Azure falls back to `DefaultAzureCredential`.

## Interfaces

Same agent, four entry points.

| Interface | Flag | Use case |
|-----------|------|----------|
| **CLI** | `--interface cli` (default with a prompt) | Pipe it, chain it, cron it |
| **REPL** | `--interface repl` (default without a prompt) | Interactive sessions with tool use and history |
| **HTTP** | `--http` | Streaming SSE or sync JSON for your product |
| **MCP** | `--mcp-stdio` / `--mcp` | Expose ra as a tool for Cursor, Claude Desktop, other agents |

```bash
# CLI — streams to stdout and exits
ra "What's wrong with this code?" --file buggy.ts
cat error.log | ra "Explain this error"

# REPL — full sessions
ra
> /skill code-review
> /attach diff.patch
> /context
> /resume abc-123

# HTTP API
ra --http --http-port 8080 --http-token secret
# POST /chat → SSE stream
# POST /chat/sync → blocking JSON
# GET /sessions → list sessions

# MCP server
ra --mcp-stdio   # stdio for Cursor / Claude Desktop
ra --mcp         # HTTP transport
```

## Built-in Tools

14 tools enabled by default. The agent can read, write, search, execute, and interact out of the box.

| Category | Tools |
|----------|-------|
| **Filesystem** | `read_file`, `write_file`, `update_file`, `append_file`, `list_directory`, `search_files`, `glob_files`, `move_file`, `copy_file`, `delete_file` |
| **Shell** | `execute_bash` / `execute_powershell` |
| **Network** | `web_fetch` |
| **Agent** | `ask_user`, `checklist` |

Tools are self-describing — each includes a schema so the model knows when and how to use them. The `checklist` tool dynamically updates its description to show remaining items, keeping the model aware of progress.

```bash
ra --no-builtin-tools  # bring your own tools via MCP
```

## Skills

Reusable instruction bundles — roles, behaviors, scripts, and reference docs packaged as directories.

```
skills/
  code-review/
    SKILL.md           # frontmatter + instructions
    scripts/
      gather-diff.sh   # runs at activation, output → context
    references/
      style-guide.md   # injected as reference
```

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

```bash
ra --skill code-review "Review the latest changes"   # CLI
ra skill install github:user/repo/path/to/skill      # install from GitHub
```

Skills support multi-runtime scripts — bash, python, typescript, javascript, go — with shebang detection.

## MCP

ra speaks MCP in both directions.

**As a client** — connect to external MCP servers. Their tools become available to the model.

```yaml
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

**As a server** — `ra --mcp-stdio` exposes the full agent loop as a single MCP tool.

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

Hook into every step of the agent loop — before the model sees your messages, after each tool returns, on every streaming token. Define hooks as inline expressions in config or as TypeScript files when you need real logic. Every hook gets the full conversation history.

| Hook | When |
|------|------|
| `beforeLoopBegin` | Once at start |
| `beforeModelCall` | Before each LLM call — mutate messages, swap models, enforce budgets |
| `onStreamChunk` | Per streaming token — log, filter, transform |
| `afterModelResponse` | After model finishes — inspect reasoning, validate output |
| `beforeToolExecution` | Before each tool call — approve, deny, rewrite arguments |
| `afterToolExecution` | After each tool returns — redact, log, modify results |
| `afterLoopIteration` | After each full iteration — check progress, decide to continue |
| `afterLoopComplete` | After the loop ends — cleanup, report |
| `onError` | On exceptions — recover, retry, escalate |

Define hooks inline or as file paths. TypeScript and JavaScript both work.

```ts
// middleware/audit-log.ts
export default async (ctx) => {
  await appendFile('audit.jsonl', JSON.stringify({
    tool: ctx.toolCall.name,
    args: ctx.toolCall.arguments,
    result: ctx.result.content,
    timestamp: Date.now()
  }) + '\n')
}
```

## Recipes

Pre-built agent configurations you can use directly or fork.

### [Coding Agent](recipes/coding-agent/)

A general-purpose coding agent with file editing, shell execution, codebase navigation, and smart context compaction. Drop-in replacement for Claude Code or Cursor CLI.

```bash
ra --config recipes/coding-agent/ra.config.yaml
```

### [Code Review Agent](recipes/code-review-agent/)

Reviews diffs for correctness, style, and performance. Includes a diff-gathering script and style guide.

```bash
ra --config recipes/code-review-agent/ra.config.yaml --file diff.patch "Review this"
```

## Configuration

Layered config. Each layer overrides the previous.

```
defaults → config file → env vars → CLI flags
```

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

compaction:
  model: claude-haiku-4-5-20251001

context:
  enabled: true
  patterns:
    - "CLAUDE.md"
    - "AGENTS.md"

storage:
  path: .ra/sessions
  maxSessions: 100
  ttlDays: 30

middleware:
  beforeModelCall:
    - "./middleware/budget.ts"
  afterToolExecution:
    - "./middleware/audit.ts"

mcp:
  client:
    - name: filesystem
      transport: stdio
      command: npx
      args: ["-y", "@anthropic/mcp-filesystem"]
```

```bash
# Environment variables
export RA_PROVIDER=anthropic
export RA_MODEL=claude-sonnet-4-6
export RA_MAX_ITERATIONS=50
export RA_ANTHROPIC_API_KEY=sk-...

# CLI flags override everything
ra --provider openai --model gpt-4.1 --thinking high --max-iterations 10 "Review this"
```

## Building from Source

```bash
bun install
bun run compile   # → dist/ra
```

## License

MIT

---

<p align="center">
  <b>ra</b> — full control over the agentic loop.
</p>
