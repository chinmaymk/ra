# ra

ra is the predictable, observable agent harness — built to run autonomously. Nothing hidden behind abstractions you can't reach. Every part of the loop is exposed via config and extensible with plain TypeScript. [Middleware hooks](/middleware/) intercept every step — model calls, tool execution, streaming. [Permissions](/permissions/) constrain what tools can do with regex allow/deny rules.

You get full control over [context engineering](/core/context-control). Automatic discovery walks your repo for `CLAUDE.md`, `AGENTS.md`, and configured patterns. Inline resolvers expand `@file` references and `url:` links before the model sees the prompt. Cache-aware [compaction](/core/context-control) manages long conversations — truncating from the back to keep prompt caches warm, or summarizing when you need semantic preservation. When a provider returns a context-length error, ra learns the real window size and adjusts.

It's designed for long-running, unattended operation. The loop runs until the task is done — no arbitrary iteration caps. [Adaptive thinking](/core/context-control) scales reasoning depth with the task. [Token budgets and duration limits](/core/agent-loop) set hard guardrails.

It comes with [built-in tools](/tools/) for filesystem, shell, network, and parallelization. Tool calls execute concurrently by default. The [Agent tool](/tools/#agent) spawns independent sub-agents for parallel workstreams. Connect to [MCP servers](/modes/mcp) for additional tools — or expose ra itself as an MCP server for Cursor, Claude Desktop, or anything that speaks the protocol.

Because everything is plain files — skills are Markdown, middleware is TypeScript, config is YAML — the model itself can extend its own capabilities at runtime. It can write new [skills](/skills/), add [middleware](/middleware/), create scripts. You set the guardrails; it builds what it needs within them.

Every action is observable. Structured JSONL logs and trace spans are written per-session automatically. The built-in [inspector](/modes/inspector) gives you a full dashboard — per-iteration token breakdown, tool call frequency, cache hit rates, timeline of every model call and tool execution, the complete message history. When someone asks "what did the agent do?" — open the inspector and see for yourself.

It runs as a [CLI](/modes/cli), [REPL](/modes/repl), [HTTP server](/modes/http), [MCP server](/modes/mcp), or on a [cron schedule](/modes/cron). Persistent [sessions](/core/sessions) via JSONL, scoped per-project. An FTS5 [memory](/tools/#memory) backed by SQLite. It talks to Anthropic, OpenAI, Google, Ollama, Bedrock, and Azure — switch providers with a flag. No runtime dependencies.

All of this is [configurable](/configuration/) via a layered config system — env vars, config files (JSON, YAML, TOML), or CLI flags. Each layer overrides the last.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
```

## Quick start

```bash
export ANTHROPIC_API_KEY="sk-..."

ra "Summarize the key points of this file" --file report.pdf   # one-shot
ra                                                              # interactive REPL
cat error.log | ra "Explain this error"                         # pipe stdin
git diff | ra --skill code-review "Review these changes"        # pipe + skill
ra --http                                                       # streaming HTTP API
ra --mcp-stdio                                                  # MCP server for Cursor / Claude Desktop
ra --interface cron                                             # scheduled autonomous jobs
```

## Why ra?

Most agent tools fall into two camps: **interactive copilots** (Claude Code, Aider, Cursor) that need a human at the keyboard, and **orchestration frameworks** (LangChain, CrewAI) that require you to write Python glue code to wire up chains, tools, and memory.

ra is neither. It's a single binary that runs your agent across seven interfaces — terminal, HTTP API, MCP server, cron — with no code changes, just a flag. You configure the agent in YAML, not Python. You control it with [middleware hooks](/middleware/) and [permissions](/permissions/), not by subclassing framework abstractions.

| | Interactive copilots | Orchestration frameworks | ra |
|---|---|---|---|
| Runs unattended | No — needs human input | Yes — but you write the orchestration | Yes — token budgets and duration limits handle it |
| Multiple interfaces | Terminal only | You build them | CLI, REPL, HTTP, MCP, cron, GitHub Actions, inspector |
| Configuration | Flags and dotfiles | Python code | YAML/JSON/TOML config files |
| Observability | Limited logs | You instrument it | Automatic structured logs, traces, and inspector dashboard |
| Extensibility | Plugins/extensions | Python classes | Middleware hooks + skills (plain Markdown and TypeScript) |

## How it works

ra's core is a loop: send messages to the model, execute any tool calls, repeat. Every step fires a middleware hook you can intercept.

```
  Your prompt
      │
      ▼
┌─────────────────────────────────────────┐
│          beforeModelCall                │
│              │                          │
│              ▼                          │
│     Stream model response               │
│         (onStreamChunk)                 │
│              │                          │
│              ▼                          │
│        afterModelResponse               │
│              │                          │
│     ┌── Has tool calls? ──┐            │
│     │                     │            │
│    Yes                    No           │
│     │                     │            │
│     ▼                     ▼            │
│  Execute tools      Loop complete       │
│     │               (done!)             │
│     ▼                                  │
│  afterToolExecution                     │
│     │                                  │
│     └──────── next iteration ──────►   │
└─────────────────────────────────────────┘
```

The model decides when it's done — when it responds with text instead of tool calls, the loop ends. [Middleware](/middleware/) can intercept any step: log token usage, enforce budgets, modify requests, or stop the loop early. [Read more about the agent loop →](/core/agent-loop)

## Use cases

### Autonomous coding agent

```bash
ra "Fix the failing tests and open a PR"
```

Reads the codebase, edits files, runs tests, iterates until green, opens the PR. Runs to completion — no iteration caps, no human-in-the-loop needed.

### CI caught a flaky test

```bash
ra --skill debugger --file test-output.log "Why is this test failing?"
```

Reads the logs, explains the root cause, and exits. Pipe the output to Slack or a PR comment.

### Your editor needs a specialist

```bash
ra --mcp-stdio
```

Now Cursor or Claude Desktop has a dedicated code reviewer that uses your project's style guide, your skills, your system prompt. [MCP](/modes/mcp) (Model Context Protocol) is the standard that lets AI tools share capabilities — ra can both consume and expose tools through it.

### Scheduled health checks

```yaml
cron:
  - name: health-check
    schedule: "*/30 * * * *"
    prompt: "Check API endpoints and report issues"
```

Runs every 30 minutes with its own session, logs, and traces.

## Recipes

Pre-built agent configurations you can install and run immediately. Each bundles a config, skills, and middleware into a self-contained agent.

```bash
ra recipe install chinmaymk/coding-agent
ra --recipe chinmaymk/coding-agent "Refactor the auth module"
```

| Recipe | What it does |
|--------|-------------|
| [Coding Agent](/recipes/#coding-agent) | Autonomous code changes with test validation |
| [Code Review Agent](/recipes/#code-review-agent) | Style-aware review with inline comments |
| [Auto-Research Agent](/recipes/#auto-research-agent) | Deep research with source synthesis |
| [Multi-Agent Orchestrator](/recipes/#multi-agent-orchestrator) | Coordinator that spawns specialized sub-agents |
| [Claude Code Agent](/recipes/#claude-code-agent) | ra configured to behave like Claude Code |

## The config is the agent

Drop a `ra.config.yml` in a repo and that directory becomes a project-specific assistant. Set env vars for a different persona. Pass `--skill` to inject a role at runtime. Run `--mcp-stdio` to expose it as a tool for Cursor or Claude Desktop. Run `--interface cron` for scheduled unattended jobs. Same binary, different agent — every time.

```yaml
# ra.config.yml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: adaptive          # deep reasoning early, lighter as execution progresses
  parallelToolCalls: true     # concurrent tool execution (default)
  maxTokenBudget: 500_000     # hard token limit for autonomous runs

  context:
    patterns:
      - "CLAUDE.md"
      - "docs/architecture.md"

  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]

  middleware:
    beforeModelCall:
      - "./middleware/budget.ts"

  skillDirs:
    - ./skills

app:
  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
```

## Autonomous operation

When an autonomous agent runs for 45 minutes at 2am, you need to know exactly what it did — and you need confidence it didn't do anything it shouldn't have. ra is built for this.

**Token budgets and duration limits** set hard guardrails — the agent stops when it hits either, regardless of where it is in the loop. **Adaptive thinking** scales reasoning depth with the task: deep analysis early when exploring, lighter responses during routine execution. This isn't just about cost — it keeps long runs focused.

**Cache-aware compaction** manages context in long conversations. When the context window fills, ra truncates older messages while keeping your system prompt and recent turns intact — this preserves prompt caches so you don't pay to re-encode the same instructions every call. When you need the meaning of older messages preserved instead, it summarizes them. When a provider returns a context-length error, ra learns the real limit and adjusts automatically.

## Security best practices

Giving an AI agent shell access is powerful and dangerous. ra provides the guardrails, but you need to configure them.

**Start with deny-all, open selectively.** The default permission mode is `ask` — every tool call requires approval. For autonomous runs, define explicit allow-lists:

```yaml
permissions:
  default_action: deny
  rules:
    - tool: Bash
      command:
        allow: ["^git (?!.*--force)", "^bun test", "^bun tsc"]
        deny: ["rm -rf", "curl.*\\|.*sh", "sudo"]
    - tool: Write
      file_path:
        allow: ["^src/", "^tests/"]
        deny: ["\\.env", "credentials", "secrets"]
```

**Key principles for production use:**
- **Deny takes priority** — if a command matches both allow and deny, it's denied
- **Restrict file writes** — limit which directories the agent can modify to prevent it from editing configs, credentials, or its own permissions
- **Block dangerous shell patterns** — piping curl to shell, `sudo`, `rm -rf /`, force pushes. The agent will see a clear error and adapt its approach
- **Use token budgets** — `maxTokenBudget` prevents runaway costs; `maxDurationSeconds` prevents runaway execution
- **Review logs** — every tool call is recorded in structured JSONL logs. The [inspector](/modes/inspector) makes post-run auditing straightforward

[Full permissions reference →](/permissions/)

## Context engineering

ra manages what the model sees so you don't have to.

**Automatic discovery** walks your repo for `CLAUDE.md`, `AGENTS.md`, and configured glob patterns, injecting relevant project context before the first model call. **Inline resolvers** expand `@file` references and `url:` links in your prompt before the model sees them — so `ra "Review @src/auth.ts"` sends the actual file contents, not the string "@src/auth.ts". **Dynamic file discovery** finds files near paths the model has already referenced, surfacing related context without you asking.

The three-zone compaction model keeps the model effective in long conversations:
- **Protected zone** — system prompt and skills, never removed
- **Compactable zone** — conversation history, truncated or summarized when space is needed
- **Recent zone** — last few turns, always kept for continuity

Run with `--show-context` to see exactly what the model receives.

## Observability

Every action is logged automatically. No instrumentation code needed.

![ra inspector dashboard showing session overview with token breakdown, tool calls, and timeline](/inspector-overview.png)

The built-in [inspector](/modes/inspector) gives you a web dashboard with per-iteration token breakdown, tool call frequency, cache hit rates, a timeline of every model call and tool execution, and the complete message history. Structured logs and trace spans are written per-session as JSONL files (one JSON object per line, easy to parse with `jq` or any log aggregator).

## What's in the box

| Feature | Description |
|---------|-------------|
| [The Agent Loop](/core/agent-loop) | Model → parallel tool execution → repeat, with adaptive thinking, token budgets, duration limits, and middleware hooks at every step |
| [Context Engineering](/core/context-control) | Automatic file discovery, `@file` and `url:` expansion, cache-aware compaction, dynamic context window learning |
| [Observability](/observability/) | Structured logs, trace spans, per-iteration token breakdown, cache metrics — all automatic |
| [Inspector](/modes/inspector) | Web dashboard — session overview, iteration-by-iteration breakdown, timeline, messages, logs, traces |
| [CLI](/modes/cli) | One-shot prompts, piping, chaining, scriptable |
| [REPL](/modes/repl) | Interactive sessions with history, slash commands, file attachments |
| [HTTP API](/modes/http) | Sync and streaming endpoints, session management |
| [MCP](/modes/mcp) | Connect to external tool servers, or expose ra itself as a tool for other AI apps |
| [Cron](/modes/cron) | Scheduled autonomous jobs with cron expressions, per-job config, isolated sessions |
| [GitHub Actions](/modes/github-actions) | Run ra directly in CI/CD workflows with no install step |
| [Built-in Tools](/tools/) | File operations, shell commands, web fetching, scratchpad, parallel sub-agents |
| [Skills](/skills/) | Reusable instruction sets — install from npm, GitHub, or URLs. The model can write new ones at runtime |
| [Middleware](/middleware/) | TypeScript hooks at every loop stage — intercept, modify, deny, or stop |
| [Permissions](/permissions/) | Regex-based allow/deny rules per tool, per field |
| [Sessions](/core/sessions) | Conversations saved as files, scoped per-project, resumable from any interface |
| [File Attachments](/core/file-attachments) | Images, PDFs, and text files — format handling adapts to each provider |
| [Memory](/tools/#memory) | Persistent searchable memory backed by SQLite — save, search, forget across conversations |
| [Configuration](/configuration/) | Layered: CLI flags > environment variables > config file, with YAML/JSON/TOML support |
| [Recipes](/recipes/) | Pre-built agent configurations — coding, code review, autonomous research, multi-agent orchestration |
