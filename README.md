<h1 align="center">ra</h1>

<p align="center"><strong>Your agent config, committed to git.</strong></p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#the-agent-loop">The Agent Loop</a> &middot;
  <a href="#context-control">Context Control</a> &middot;
  <a href="#providers">Providers</a> &middot;
  <a href="#interfaces">Interfaces</a> &middot;
  <a href="#built-in-tools">Tools</a> &middot;
  <a href="#permissions">Permissions</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#sessions">Sessions</a> &middot;
  <a href="#mcp">MCP</a> &middot;
  <a href="#middleware">Middleware</a> &middot;
  <a href="#observability">Observability</a> &middot;
  <a href="#memory">Memory</a> &middot;
  <a href="#recipes">Recipes</a> &middot;
  <a href="#github-actions">GitHub Actions</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

---

Ra is an agent loop you configure with a YAML file and run as a single binary. It reads stdin, talks to the model, writes to stdout. Pipe it, chain it, cron it. Run it as a CLI, REPL, HTTP server, or MCP server. No runtime dependencies.

```bash
ra "What is the capital of France?"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --skill code-review --file diff.patch "Review this diff"
cat server.log | ra "Find the root cause of these errors"
ra   # interactive REPL
```

The config lives in your repo — skills, permissions, middleware — versioned and reviewable. When a new engineer clones the project, they get the same agent behavior everyone else has. No setup docs. It's just there.

```yaml
# ra.config.yml — checked into your repo, reviewed in PRs
provider: anthropic
model: claude-sonnet-4-6
maxIterations: 50
thinking: medium
skills: [code-review, architect]

permissions:
  rules:
    - tool: execute_bash
      command:
        allow: ["^git ", "^bun "]
        deny: ["--force", "--hard"]
```

Ra doesn't ship with a system prompt. Every part of the loop is exposed via config and can be extended by writing scripts or plain TypeScript. [Middleware hooks](#middleware) intercept every step — model calls, tool execution, streaming, all of it. When someone asks "what is our AI agent actually doing?" — here's the config, here's the middleware, here's the [audit log](#observability).

It talks to [multiple providers](#providers) — Anthropic, OpenAI, Google, Ollama, Bedrock, Azure. Switch with a flag or lock it in config. Use a local Ollama model for code that shouldn't leave your machine, a frontier model when you need the reasoning. Same config, different `--provider` flag.

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

Ra's core loop is simple: send messages to the model, stream the response, execute any tool calls, repeat. Every step fires a middleware hook you can intercept. The loop handles iteration, token tracking, and tool execution — you control everything else through system prompts, skills, and middleware.

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
         ├── AskUserQuestion? ──► suspend (loop exits without afterLoopComplete)
         │
         ▼
   afterToolExecution
         │
         ▼
   afterLoopIteration ────────────────────►┘
```

The loop tracks token usage per iteration, enforces `maxIterations`, and supports an `AbortController` — any middleware can call `ctx.stop()` to halt the loop cleanly.

## Context Control

### Smart context compaction

When conversations grow, ra compacts automatically. It splits the history into three zones — pinned messages (system prompt, first user message), compactable middle, and recent turns — then summarizes the middle with a cheap model. You keep the context that matters.

```yaml
compaction:
  enabled: true
  threshold: 0.8               # trigger at 80% of context window
  model: claude-haiku-4-5-20251001  # cheap model for summarization
```

Uses real token counts when available, never splits tool call boundaries, and picks a cheap default compaction model per provider (Haiku for Anthropic, GPT-4o-mini for OpenAI, Gemini Flash for Google).

### Token tracking & prompt caching

Ra tracks input and output tokens across every iteration. Your middleware can read cumulative usage via `ctx.loop.usage` and enforce budgets, log costs, or trigger compaction early. On Anthropic, cache hints are automatically added to system prompts and tool definitions — no config needed.

### Extended thinking

```bash
ra --thinking high "Design a database schema for a social network"
```

Three budget levels (`low`, `medium`, `high`) control how much the model reasons before responding. Thinking output streams to the terminal in real time.

### Context discovery

Ra discovers and injects project context files into the conversation before your prompt. Configure which files to look for via the `context.patterns` config:

```yaml
context:
  enabled: true
  patterns:
    - "CLAUDE.md"
    - "AGENTS.md"
    - "CONVENTIONS.md"
```

Ra walks the directory tree upward to the git root, finds matching files, and injects them as context.

### Pattern resolution

Reference files and URLs inline in your prompts — ra resolves them before the model sees the message.

```bash
ra "explain what @src/auth.ts does"            # file contents injected
ra "review @src/utils/*.ts for consistency"     # glob expansion
ra "summarize url:https://example.com/api-docs" # fetched page content
```

Two built-in resolvers (`@` for files/globs, `url:` for URLs) are enabled by default. Add custom resolvers for GitHub issues, database records, or anything else via `context.resolvers` in your config.

## Providers

Six backends. Switch with a flag or set it in config.

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

Same agent, multiple entry points.

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

Both endpoints accept `{"messages": [...], "sessionId": "..."}`. The streaming endpoint also emits `AskUserQuestion` events when the agent needs input.

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

15 tools enabled by default (platform-specific: `Bash` on Linux/macOS, `PowerShell` on Windows). Tools are self-describing — each includes a detailed schema and description so the model knows when and how to use them.

| Category | Tools |
|----------|-------|
| **Filesystem** | `Read`, `Write`, `Edit`, `AppendFile`, `LS`, `Grep`, `Glob`, `MoveFile`, `CopyFile`, `DeleteFile` |
| **Shell** | `Bash` (Linux/macOS) / `PowerShell` (Windows) |
| **Network** | `WebFetch` |
| **Agent** | `AskUserQuestion`, `TodoWrite`, `Agent` |

The `Edit` tool does exact string replacement — same pattern as Claude Code's Edit tool. The `TodoWrite` tool dynamically updates its description to show remaining items, keeping the model aware of progress.

The `AskUserQuestion` tool suspends the agent loop and returns control to the caller. In the REPL, the question is printed and the next input resumes the conversation. In CLI mode, it prints the session ID so you can `--resume` later. In HTTP mode, it emits an `AskUserQuestion` SSE event.

The `Agent` tool forks parallel copies of the agent to work on independent tasks simultaneously. Each fork inherits the parent's model, system prompt, tools, and thinking level — it's the same agent with a fresh conversation. Token usage rolls up into the parent automatically. Recursion depth is capped (default: 2 levels).

## Permissions

Control what tools can do with regex-based allow/deny rules per tool, per field. Deny always takes priority.

```yaml
# ra.config.yml
permissions:
  rules:
    - tool: execute_bash
      command:
        allow: ["^git ", "^bun "]
        deny: ["--force", "--hard", "--no-verify"]
    - tool: write_file
      path:
        allow: ["^src/", "^tests/"]
        deny: ["\\.env"]
```

Each rule key (other than `tool`) matches a field from the tool's input schema. When a call is denied, the model gets a clear error and can adjust. Set `default_action: deny` for an allowlist-only approach.

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

Ra ships with ready-to-use skills:

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

Ra persists every conversation as JSONL. Resume any session from any interface.

```bash
ra --resume <session-id> "Continue with the next step"
```

```yaml
dataDir: .ra              # root for all runtime data (sessions, memory, etc.)
storage:
  maxSessions: 100        # auto-prune oldest
  ttlDays: 30             # auto-expire
```

Sessions are auto-saved after each turn. The REPL has `/resume <id>` and the HTTP API accepts a `sessionId` field. When `AskUserQuestion` suspends a CLI run, the session ID is printed to stderr so you can resume later.

## MCP

Ra speaks MCP in both directions.

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
  lazySchemas: true   # default — strip schemas, reveal on first call
```

All MCP tools get **server-prefixed names** (`github__search`, `database__query`) to avoid conflicts across servers. With **lazy schema loading** (default), only the `inputSchema` is stripped. The first call to each tool returns the full parameter schema instead of executing — the model retries with correct parameters. You only pay for schemas of tools actually used.

**As a server** — `ra --mcp-stdio` exposes the full agent loop as a single MCP tool, plus all built-in tools as individual MCP tools. See [Interfaces → MCP server](#mcp-server) for config examples.

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
// middleware/token-budget.ts — stop if we've used too many tokens
export default async (ctx) => {
  if (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens > 100_000) {
    ctx.stop()
  }
}
```

Hooks can also be inline expressions in config for simple cases. All hooks support a configurable timeout via `toolTimeout` (default: 30s).

## Observability

Structured JSON logging and tracing are built in. By default, logs and traces are written to the session directory alongside conversation messages — keeping stdout/stderr clean.

```
.ra/sessions/{session-id}/
  meta.json          # session metadata
  messages.jsonl     # conversation messages
  logs.jsonl         # structured logs
  traces.jsonl       # trace spans
```

Logs and traces are enabled by default and written to the session directory. Control them with environment variables:

```bash
RA_LOGS_ENABLED=true       # toggle session logs (default: true)
RA_LOG_LEVEL=info          # debug | info | warn | error
RA_TRACES_ENABLED=true     # toggle session traces (default: true)
```

Every startup event, model call, tool execution, compaction, and error is logged. Traces follow an OpenTelemetry-inspired span hierarchy (`agent.loop` → `agent.iteration` → `agent.model_call` / `agent.tool_execution`), each recording duration, status, and attributes. Both emit JSONL — pipe through `jq` to explore. See [docs/observability.md](docs/observability.md) for the full event reference.

## Memory

SQLite-backed memory with FTS5 full-text search. The agent gets `memory_save`, `memory_search`, and `memory_forget` tools, and recent memories are injected at the start of each loop.

```bash
ra --memory                       # enable memory for this session
ra --list-memories                # list all stored memories
ra --memories "typescript"        # search memories
ra --forget "dark mode"           # delete matching memories
```

```yaml
memory:
  enabled: true
  maxMemories: 1000
  ttlDays: 90
  injectLimit: 5           # inject top-N recent memories (0 to disable)
```

The agent decides when to save and forget — tool descriptions guide it to capture user preferences, project decisions, and corrections.

## Recipes

Complete agent configurations you can use directly or fork. Each recipe is a `ra.config.yml` that solves a specific, named problem — clone it, tweak it, commit it to your repo.

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

The same pattern works for any repeatable workflow — standup prep from your git log, dependency upgrade bots, incident postmortem drafters, onboarding agents that answer questions using your actual codebase. Each is a config file you can fork and commit to your repo.

## GitHub Actions

Use ra directly in your CI/CD workflows. No install step needed — the action downloads the binary automatically.

```yaml
- uses: chinmaymk/ra@latest
  with:
    prompt: "Review this PR for bugs and security issues"
    provider: anthropic
    model: claude-sonnet-4-6
  env:
    RA_ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The action exposes the same configuration as the CLI — provider, model, skills, thinking, file attachments, and custom config files. See the [GitHub Actions docs](docs/site/modes/github-actions.md) for full usage.

## Configuration

Layered config. Each layer overrides the previous.

```
defaults → config file → env vars → CLI flags
```

```yaml
# ra.config.yml — all sections are optional
provider: anthropic
model: claude-sonnet-4-6
systemPrompt: You are a helpful coding assistant.
maxIterations: 50
thinking: medium
skills: [code-review]
```

Every option shown in the sections above (`compaction`, `permissions`, `memory`, `mcp`, `middleware`, etc.) goes in this file. Environment variables use the `RA_` prefix (`RA_PROVIDER`, `RA_MODEL`, `RA_ANTHROPIC_API_KEY`), and CLI flags override everything:

```bash
ra --provider openai --model gpt-4.1 --thinking high --max-iterations 10 "Review this"
```

## Scripting

Use `--exec` to run a TypeScript or JavaScript file that imports ra's internals programmatically.

```bash
ra --exec ./scripts/batch-review.ts
```

## Building from Source

```bash
git clone https://github.com/chinmaymk/ra.git && cd ra
bun install
bun run compile   # → dist/ra
bun tsc           # type-check
bun test          # run tests
```

## License

MIT

---

<p align="center">
  <b>ra</b> — Your agent config, committed to git.
</p>
