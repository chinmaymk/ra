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

ra is an open-source AI agent framework that gives you a configurable agentic loop and stays out of your way. It's a single binary that turns any LLM — Anthropic, OpenAI, Google, Ollama, AWS Bedrock, Azure — into a tool-using agent you can run as a CLI command, an interactive REPL, a streaming HTTP API, or an MCP server.

Every message, every tool call, every stream chunk is visible and interceptable through middleware hooks. You configure agents in YAML — define tools, skills, system prompts, and context — and drop down to TypeScript only where you need custom logic.

```bash
ra "What is the capital of France?"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --skill code-review --file diff.patch "Review this diff"
cat server.log | ra "Find the root cause of these errors"
ra   # interactive REPL
```

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

ra's core loop is simple: send messages to the model, stream the response, execute any tool calls, repeat. Every step fires a middleware hook you can intercept. The loop handles iteration, token tracking, and tool execution — you control everything else through system prompts, skills, and middleware.

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

### Pattern resolution

Reference files and URLs inline in your prompts — ra resolves them before the model sees the message.

```bash
ra "explain what @src/auth.ts does"            # file contents injected
ra "review @src/utils/*.ts for consistency"     # glob expansion
ra "summarize url:https://example.com/api-docs" # fetched page content
```

Two built-in resolvers (`@` for files/globs, `url:` for URLs) are enabled by default. Add custom resolvers for GitHub issues, database records, or anything else:

```yaml
context:
  resolvers:
    - name: issues
      path: ./resolvers/github-issues.ts
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
> /memories                   # see what the agent remembers
> /forget dark mode           # delete memories matching a query
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

14 tools enabled by default (platform-specific: `execute_bash` on Linux/macOS, `execute_powershell` on Windows). Tools are self-describing — each includes a detailed schema and description so the model knows when and how to use them.

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

Reusable instruction bundles — roles, behaviors, scripts, and reference docs packaged as directories. Skills use progressive disclosure: the model sees skill names and descriptions first, then reads the full SKILL.md on demand.

```
skills/
  code-review/
    SKILL.md           # frontmatter + instructions
    scripts/
      gather-diff.sh   # on-demand — model runs when needed
    references/
      style-guide.md   # on-demand — read via /skill-ref
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
ra --skill code-review "Review the latest changes"   # CLI — always-on
ra skill install github:user/repo                     # install from GitHub
ra skill install npm:ra-skill-lint@1.0                # install from npm
ra skill install https://example.com/skills.tgz       # install from URL
ra skill list                                         # list installed skills
ra skill remove code-review                           # remove a skill
```

Scripts and references are loaded on demand — not eagerly at activation. In the REPL, use `/skill-run <skill> <script>` and `/skill-ref <skill> <reference>` to load them into context when needed. Skills support multi-runtime scripts (bash, python, typescript, javascript, go) with shebang detection.

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

## Observability

Structured JSON logging and tracing are built in. Every agent loop emits logs and trace spans to stderr by default — no extra setup needed.

```yaml
# ra.config.yml
observability:
  enabled: true          # default: true
  logs:
    level: info          # debug | info | warn | error
    output: stderr       # stderr | stdout | file
    filePath: .ra/logs.jsonl
  traces:
    output: file
    filePath: .ra/traces.jsonl
```

### What gets logged

| Event | Level | Key fields |
|-------|-------|------------|
| `agent loop starting` | info | maxIterations, messageCount |
| `calling model` | debug | iteration, model, messageCount |
| `model responded` | info | inputTokens, outputTokens, toolCallCount, toolNames |
| `executing tool` | info | tool, toolCallId, input (truncated) |
| `tool execution complete` | info | tool, resultLength |
| `tool execution failed` | error | tool, error |
| `context compacted` | info | originalMessages, compactedMessages, estimatedTokens, threshold |
| `iteration complete` | debug | iteration, messagesAdded |
| `agent loop complete` | info | iterations, inputTokens, outputTokens, totalMessages |
| `agent loop failed` | error | error, stack, phase, iterations |

### Trace spans

Spans follow an OpenTelemetry-inspired hierarchy:

```
agent.loop
  └── agent.iteration (per loop iteration)
        ├── agent.model_call
        └── agent.tool_execution (per tool call)
```

Each span records duration, status (`ok`/`error`), and relevant attributes (token counts, tool names, result lengths).

### Output format

Both logs and traces emit one JSON object per line (JSONL). Logs include `timestamp`, `level`, `message`, and `sessionId`. Traces include `traceId`, `spanId`, `parentSpanId`, `name`, `durationMs`, and `attributes`.

```bash
# Watch logs in real time
tail -f .ra/logs.jsonl | jq .

# Filter to just errors
tail -f .ra/logs.jsonl | jq 'select(.level == "error")'

# Show trace span durations
tail -f .ra/traces.jsonl | jq '{name, durationMs, status}'
```

To disable all observability output:

```yaml
observability:
  enabled: false
```

## Memory

ra can persist facts across conversations using an SQLite-backed memory store with full-text search. The agent gets three tools — `memory_save`, `memory_search`, and `memory_forget` — and recent memories are automatically injected at the start of each loop.

```bash
ra --memory                       # enable memory for this session
ra --list-memories                # list all stored memories
ra --memories "typescript"        # search memories
ra --forget "dark mode"           # delete matching memories
```

In the REPL:

```
> /memories          # see what the agent remembers
> /memories 5        # show last 5 memories
> /forget dark mode  # manually delete memories matching "dark mode"
```

For persistent configuration:

```yaml
# ra.config.yml
memory:
  enabled: true
  path: .ra/memory.db     # SQLite database location
  maxMemories: 1000        # oldest trimmed first
  ttlDays: 90              # auto-prune after 90 days
  injectLimit: 5          # inject top-N recent memories (0 to disable)
```

The agent decides when to save and forget — tool descriptions guide it to capture user preferences, project decisions, and corrections, and to forget outdated information when told.

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

memory:
  enabled: true
  path: .ra/memory.db
  maxMemories: 1000
  ttlDays: 90
  injectLimit: 5

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
ra --exec ./scripts/batch-review.ts
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
