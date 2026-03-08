<h1 align="center">ra</h1>

<p align="center">
  <b>One Loop. Infinite Agents.</b><br>
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#the-agent-loop">The Agent Loop</a> &middot;
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

## What is ra?

ra is an open-source AI agent framework that gives you full control over the agentic loop. It's a single binary that turns any LLM — Anthropic, OpenAI, Google, Ollama, AWS Bedrock, Azure — into a tool-using agent you can run as a CLI command, an interactive REPL, a streaming HTTP API, or an MCP server.

Every message, every tool call, every stream chunk is visible and interceptable through middleware hooks. You configure agents in YAML — define tools, skills, system prompts, and context — and drop down to TypeScript only where you need custom logic.

```bash
ra "What is the capital of France?"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --skill code-review --file diff.patch "Review this diff"
cat server.log | ra "Find the root cause of these errors"
ra   # interactive REPL
```

## Features

- **Batteries included** — 14 built-in tools for filesystem operations, shell execution, HTTP requests, and user interaction. The agent can read, write, search, and run commands out of the box — no setup required.
- **Extensible agentic loop** — A real model→tools→repeat loop with streaming, tool calling, and context compaction built in. Middleware hooks let you intercept every step — before the model call, after tool execution, on each stream chunk. Write hooks in TypeScript or JavaScript, inline or as files. Build guardrails, logging, or custom routing without forking anything.
- **Config-driven identity** — One binary becomes a code reviewer, a support bot, a CI agent, or anything else. Drop a `ra.config.yml` and the agent reshapes itself.
- **Provider portable** — Anthropic, OpenAI, Google, Bedrock, Ollama. Same config, any backend. Switch with a flag when one is down or slow.
- **Skills** — Package expertise into reusable bundles with instructions, scripts, and reference docs. Inject at runtime or wire always-on. Skills can include shell scripts in any language that run at activation and feed context to the model.
- **Pattern resolution** — Reference files with `@src/auth.ts`, URLs with `url:https://...`, or build custom resolvers for GitHub issues, database records, or anything else. References resolve automatically before the model sees the message.
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
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
ra --help
```

## Quick Start

```bash
export RA_ANTHROPIC_API_KEY="sk-..."

ra "Summarize the key points of this file" --file report.pdf   # one-shot with file attachment
ra                                                              # interactive REPL
cat error.log | ra "Explain this error"                         # pipe stdin
git diff | ra --skill code-review "Review these changes"        # pipe + skill
ra --http                                                       # streaming HTTP API
ra --mcp-stdio                                                  # MCP server for Cursor / Claude Desktop
```

## The Agent Loop

ra runs a single, transparent loop: send messages to the model, stream the response, execute tool calls, repeat. Every step fires a middleware hook you can intercept.

```
┌─────────────────────────────────────────────────┐
│                  beforeLoopBegin                │
└──────────────────────┬──────────────────────────┘
                       ▼
         ┌─── beforeModelCall ◄────────────┐
         │                                 │
         ▼                                 │
    Stream response                        │
    (onStreamChunk)                        │
         │                                 │
         ▼                                 │
   afterModelResponse                      │
         │                                 │
         ├── No tool calls? ──► afterLoopComplete
         │
         ▼
   beforeToolExecution
         │
         ▼
    Execute tools
         │
         ├── ask_user? ──► suspend (loop exits without afterLoopComplete)
         │
         ▼
   afterToolExecution
         │
         ▼
   afterLoopIteration ────────────────────►┘
```

The loop tracks token usage per iteration, enforces `maxIterations`, and supports an `AbortController` — any middleware can call `ctx.stop()` to halt the loop cleanly.

## Context Control

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
  enabled: true
  threshold: 0.8               # trigger at 80% of context window
  model: claude-haiku-4-5-20251001  # cheap model for summarization
```

- **Token-aware** — Uses real token counts from the provider when available, falls back to estimation.
- **Pinned zones** — System prompts and initial context never get compacted.
- **Tool-call-aware** — Boundaries never split an assistant message from its tool results.
- **Provider-portable** — Works the same across all providers. Default compaction models per provider (Haiku for Anthropic, GPT-4o-mini for OpenAI, Gemini Flash for Google).

### Token tracking

ra tracks input and output tokens across every iteration of the loop. Your middleware can read cumulative usage via `ctx.loop.usage` and enforce budgets, log costs, or trigger compaction early.

### Prompt caching

Automatic cache hints on system prompts and tool definitions for Anthropic, reducing costs on multi-turn sessions without any config.

### Extended thinking

Enable extended thinking for models that support it. Three budget levels control how much the model reasons before responding.

```bash
ra --thinking high "Design a database schema for a social network"
```

```yaml
thinking: high  # low | medium | high (token budgets vary by provider)
```

Thinking output streams to the terminal in the REPL, so you can watch the model reason in real time.

### Context discovery

ra can discover and inject project context files into the conversation before your prompt. Configure which files to look for via the `context.patterns` config:

```yaml
context:
  enabled: true
  patterns:
    - "CLAUDE.md"
    - "AGENTS.md"
    - "CONVENTIONS.md"
```

ra walks the directory tree upward to the git root, finds matching files, and injects them as context.

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

> Bedrock falls back to the standard AWS credential chain. Azure falls back to `DefaultAzureCredential`. Anthropic, OpenAI, and Google support `--<provider>-base-url` flags. Ollama uses `--ollama-host`, Azure uses `--azure-endpoint`.

## Interfaces

Same agent, four entry points.

| Interface | Flag | Use case |
|-----------|------|----------|
| **CLI** | `--interface cli` (default with a prompt) | Pipe it, chain it, cron it |
| **REPL** | `--interface repl` (default without a prompt) | Interactive sessions with tool use and history |
| **HTTP** | `--http` | Streaming SSE or sync JSON for your product |
| **MCP** | `--mcp-stdio` / `--mcp` | Expose ra as a tool for Cursor, Claude Desktop, other agents |

### CLI

Streams to stdout and exits. Supports piped stdin — when input is piped, ra reads it and auto-switches to CLI mode.

```bash
ra "What's wrong with this code?" --file buggy.ts
cat error.log | ra "Explain this error"
git diff | ra "Summarize these changes"
echo "hello world" | ra                             # stdin becomes the prompt
ra --resume <session-id> "Continue from where we left off"
```

### REPL

Full interactive sessions with slash commands.

```bash
ra
> How does the auth module work?
> /skill code-review          # activate a skill for next message
> /attach diff.patch          # attach a file to next message
> /context                    # show discovered context files
> /resume abc-123             # resume a previous session
> /clear                      # start fresh
```

### HTTP API

```bash
ra --http --http-port 8080 --http-token secret
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/chat` | POST | SSE stream — `data: {"type":"text","delta":"..."}` |
| `/chat/sync` | POST | Blocking JSON — `{"response":"..."}` |
| `/sessions` | GET | List stored sessions |

Both endpoints accept `{"messages": [...], "sessionId": "..."}`. The streaming endpoint also emits `ask_user` events when the agent needs input.

### MCP server

Expose the full agent loop as a tool for other agents.

```bash
ra --mcp-stdio   # stdio for Cursor / Claude Desktop
ra --mcp         # HTTP transport
```

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

When built-in tools are enabled, they're also exposed as individual MCP tools — so other agents get access to ra's filesystem, shell, and network tools directly.

## Built-in Tools

14 tools enabled by default (platform-specific: `execute_bash` on Linux/macOS, `execute_powershell` on Windows). The agent can read, write, search, execute, and interact out of the box.

| Category | Tools |
|----------|-------|
| **Filesystem** | `read_file`, `write_file`, `update_file`, `append_file`, `list_directory`, `search_files`, `glob_files`, `move_file`, `copy_file`, `delete_file` |
| **Shell** | `execute_bash` (Linux/macOS) / `execute_powershell` (Windows) |
| **Network** | `web_fetch` |
| **Agent** | `ask_user`, `checklist` |

The `update_file` tool does exact string replacement — same pattern as Claude Code's Edit tool. The `checklist` tool dynamically updates its description to show remaining items, keeping the model aware of progress.

The `ask_user` tool suspends the agent loop and returns control to the caller. In the REPL, the question is printed and the next input resumes the conversation. In CLI mode, it prints the session ID so you can `--resume` later. In HTTP mode, it emits an `ask_user` SSE event.

To bring your own tools via MCP instead, set `builtinTools: false` in your config file.

## File Attachments

Attach images, PDFs, and text files to any prompt. ra detects the MIME type and sends the content in the right format for each provider.

```bash
ra --file screenshot.png "What's wrong with this UI?"
ra --file report.pdf --file data.csv "Summarize both files"
```

In the REPL, use `/attach`:

```
> /attach architecture.png
> How should we refactor this?
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
ra skill install github:user/repo                     # install from GitHub
ra skill install github:user/repo@v2                  # pin to a tag
```

Skills support multi-runtime scripts — bash, python, typescript, javascript, go — with shebang detection. Script output is injected into the conversation as context.

### Built-in skills

ra ships with six ready-to-use skills:

| Skill | Purpose |
|-------|---------|
| `code-review` | Reviews code for bugs, security, style, and correctness |
| `architect` | Designs systems and evaluates architecture decisions |
| `planner` | Breaks work into concrete steps before implementation |
| `debugger` | Systematically diagnoses bugs and unexpected behavior |
| `code-style` | Reviews and writes code for clarity, simplicity, and correctness |
| `writer` | Writes clear technical documentation, READMEs, and guides |

```bash
ra --skill architect "Design a queue system for email notifications"
ra --skill debugger --file crash.log "Find the root cause"
```

## Sessions

ra persists every conversation as JSONL. Resume any session from any interface.

```bash
ra --resume <session-id> "Continue with the next step"
```

```yaml
storage:
  path: .ra/sessions
  maxSessions: 100     # auto-prune oldest
  ttlDays: 30           # auto-expire
```

Sessions are auto-saved after each turn. The REPL has `/resume <id>` and the HTTP API accepts a `sessionId` field. When `ask_user` suspends a CLI run, the session ID is printed to stderr so you can resume later.

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
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
      env:
        GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
```

**As a server** — `ra --mcp-stdio` exposes the full agent loop as a single MCP tool, plus all built-in tools as individual MCP tools.

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

You can also run the MCP server alongside another interface — for example, a REPL with an MCP sidecar:

```bash
ra --mcp-server-enabled --mcp-server-port 4000 --repl
```

## Middleware

Hook into every step of the agent loop. Define hooks as inline expressions in config or as TypeScript files when you need real logic. Every hook gets the full conversation history and can call `ctx.stop()` to halt the loop.

| Hook | When | Context |
|------|------|---------|
| `beforeLoopBegin` | Once at start | messages, iteration, usage |
| `beforeModelCall` | Before each LLM call | request (messages, model, tools), loop state |
| `onStreamChunk` | Per streaming token | chunk (text/thinking/tool_call), loop state |
| `afterModelResponse` | After model finishes | request, loop state |
| `beforeToolExecution` | Before each tool call | toolCall (name, arguments, id), loop state |
| `afterToolExecution` | After each tool returns | toolCall, result (content, isError), loop state |
| `afterLoopIteration` | After each full iteration | messages, iteration, usage |
| `afterLoopComplete` | After the loop ends | messages, iteration, usage |
| `onError` | On exceptions | error, phase (model_call/tool_execution/stream), loop state |

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

```ts
// middleware/token-budget.ts — stop if we've used too many tokens
export default async (ctx) => {
  if (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens > 100_000) {
    ctx.stop()
  }
}
```

Inline hooks work for simple cases:

```yaml
middleware:
  onStreamChunk:
    - "(ctx) => { process.stdout.write(ctx.chunk.type === 'text' ? ctx.chunk.delta : '') }"
```

All hooks support a configurable timeout via `toolTimeout` (default: 30s).

## Recipes

Pre-built agent configurations you can use directly or fork.

### [Coding Agent](recipes/coding-agent/)

A general-purpose coding agent with file editing, shell execution, codebase navigation, extended thinking, and smart context compaction. Uses 200 max iterations and high thinking budget.

```bash
ra --config recipes/coding-agent/ra.config.yaml
```

### [Code Review Agent](recipes/code-review-agent/)

Reviews diffs for correctness, style, and performance. Connects to GitHub via MCP, includes a diff-gathering script and style guide, and enforces a token budget via middleware.

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
toolTimeout: 30000

skills:
  - code-review
skillDirs:
  - ./skills

compaction:
  enabled: true
  threshold: 0.8
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

## Scripting

Use `--exec` to run a TypeScript or JavaScript file that imports ra's internals programmatically.

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

## Pattern Resolution

Pattern resolvers let you reference files, URLs, and custom sources inline in your prompts using short prefixes. ra resolves these references before the model sees the message, appending the resolved content automatically.

Two built-in resolvers are enabled by default:

| Pattern | Example | Resolves to |
|---------|---------|-------------|
| `@<path>` | `@src/index.ts` | File contents |
| `@<glob>` | `@src/**/*.ts` | All matching file contents |
| `url:<url>` | `url:https://example.com` | Fetched page content |

### Usage

```bash
# Reference a file — its contents are injected as context
ra "explain what @src/auth.ts does"

# Reference multiple files with a glob
ra "review @src/utils/*.ts for consistency"

# Fetch a URL
ra "summarize url:https://example.com/api-docs"

# Mix them
ra "compare @lib/old.ts with the approach described at url:https://blog.example.com/new-pattern"
```

Resolved content is appended to your message as XML blocks:

```xml
<resolved-context ref="@src/auth.ts">
[file contents]
</resolved-context>
```

### Configuration

Resolvers are configured under `context.resolvers`. Both built-in resolvers are on by default.

```yaml
# ra.config.yml
context:
  resolvers:
    - name: file
      enabled: true       # @ prefix — on by default
    - name: url
      enabled: true       # url: prefix — on by default
    - name: issues
      enabled: true
      path: ./resolvers/github-issues.ts   # custom resolver
```

To disable a built-in resolver:

```yaml
context:
  resolvers:
    - name: file
      enabled: false
```

### Custom Resolvers

Write a TypeScript file that exports a `PatternResolver`:

```ts
// resolvers/github-issues.ts
import type { PatternResolver } from '@chinmaymk/ra'

export default {
  name: 'issues',
  pattern: /#(\d+)/g,
  resolve: async (ref) => {
    const res = await fetch(`https://api.github.com/repos/myorg/myrepo/issues/${ref}`)
    if (!res.ok) return null
    const issue = await res.json()
    return `[Issue #${ref}] ${issue.title}\n\n${issue.body}`
  },
} satisfies PatternResolver
```

The `pattern` regex must have one capture group — the captured value is passed to `resolve()`. Return `null` to skip a match.

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
bun run compile   # → dist/ra
```

## License

MIT

---

<p align="center">
  <b>ra</b> — full control over the agentic loop.
</p>
