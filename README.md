<h1 align="center">ra</h1>

<p align="center"><strong>The predictable, observable agent harness.</strong></p>

<p align="center">
  <a href="https://github.com/chinmaymk/ra/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://github.com/chinmaymk/ra/actions"><img src="https://img.shields.io/github/actions/workflow/status/chinmaymk/ra/ci.yml?branch=main" alt="Build"></a>
  <a href="https://github.com/chinmaymk/ra/releases"><img src="https://img.shields.io/github/v/release/chinmaymk/ra?include_prereleases" alt="Release"></a>
</p>

<p align="center">
  <a href="#use-cases">Use Cases</a> &middot;
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#the-agent-loop">The Agent Loop</a> &middot;
  <a href="#providers">Providers</a> &middot;
  <a href="#tools">Tools</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#middleware">Middleware</a> &middot;
  <a href="#mcp-server">MCP Server</a> &middot;
  <a href="#parallel-agents">Parallel Agents</a> &middot;
  <a href="#observability">Observability</a> &middot;
  <a href="#memory">Memory</a> &middot;
  <a href="#context-discovery">Context Discovery</a> &middot;
  <a href="#sessions">Sessions</a> &middot;
  <a href="#file-attachments">File Attachments</a> &middot;
  <a href="#interfaces">Interfaces</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#recipes">Recipes</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="ra demo" width="800">
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
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  maxIterations: 50
  thinking: medium
  skillDirs:
    - ./skills
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]
```

Ra doesn't ship with a system prompt. Every part of the loop is exposed via config and can be extended by writing scripts or plain TypeScript. [Middleware hooks](https://chinmaymk.github.io/ra/middleware/) intercept every step — model calls, tool execution, streaming, all of it. When someone asks "what is our AI agent actually doing?" — here's the config, here's the middleware, here's the [audit log](https://chinmaymk.github.io/ra/observability/).

It talks to [multiple providers](https://chinmaymk.github.io/ra/providers/anthropic/) — Anthropic, OpenAI, Google, Ollama, Bedrock, Azure. Switch with a flag or lock it in config. Use a local Ollama model for code that shouldn't leave your machine, a frontier model when you need the reasoning.

```bash
# Run as a coding agent in your terminal
ra "Why is this test failing?" --file test-output.log
# Expose as an MCP tool for Cursor or Claude Desktop
ra --mcp-stdio --skill code-review
# Serve a streaming HTTP API for your product
ra --http --http-port 3000
```

## Use Cases

Ra is a general-purpose agent loop — the same binary powers wildly different workflows depending on how you configure it.

- **Code agent** — edit files, run tests, fix bugs, review PRs. Point it at a repo with the right tools and permissions and it's a full coding assistant.
- **Research agent** — feed it docs, URLs, or a knowledge base. Pair with web fetch and memory to build an agent that investigates questions, synthesizes sources, and remembers what it learned.
- **CI agent** — run in GitHub Actions or any CI pipeline to review PRs, enforce style, triage failing tests, or generate changelogs on every push.
- **Documentation agent** — point it at a codebase or doc set and it can generate docs, keep them in sync with code, or answer questions grounded in the content. Use the writer skill to draft, or run it as an MCP server so other tools can query your docs through it.
- **Security agent** — audit code for vulnerabilities, enforce policies, run compliance checks. Middleware logging gives you a full audit trail of every action the agent took and why.
- **Data analysis agent** — pipe in CSVs, query results, or log files. Let it summarize, spot anomalies, generate reports. Combine with memory to track trends across runs.
- **On-call agent** — pipe alerts or production logs in, let it triage and correlate. Memory means it learns from past incidents — it gets better at your system over time.
- **Personal agent** — wire it up as a REPL or HTTP server for daily tasks: drafting emails, summarizing meeting notes, managing todos, querying your own data via MCP tools.

The building blocks are the same — providers, tools, skills, middleware — you just compose them differently. One config file defines a code reviewer; another defines a research assistant. Versatility is the point.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
ra --help
```

## Quick Start

```bash
export ANTHROPIC_API_KEY="sk-..."

ra "Summarize the key points of this file" --file report.pdf   # one-shot
ra                                                              # interactive REPL
cat error.log | ra "Explain this error"                         # pipe stdin
git diff | ra --skill code-review "Review these changes"        # pipe + skill
ra --http                                                       # HTTP API
ra --mcp-stdio                                                  # MCP server
```

## [The Agent Loop](https://chinmaymk.github.io/ra/core/agent-loop/)

Send messages to the model, stream the response, execute any tool calls, repeat. Every step fires a middleware hook you can intercept.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → stream response → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → execute tools → [afterToolExecution]
  → [afterLoopIteration] → repeat or [afterLoopComplete]
```

The loop tracks token usage, enforces `maxIterations`, and any middleware can call `ctx.stop()` to halt it. [Context compaction](https://chinmaymk.github.io/ra/core/context-control/) kicks in automatically when conversations grow — summarizing older turns with a cheap model while preserving system prompts and recent context. [Extended thinking](https://chinmaymk.github.io/ra/core/context-control/) is supported at five levels (`off`, `low`, `medium`, `high`, `adaptive`) for models that support it — `adaptive` starts with high thinking and lowers it as the loop progresses.

## [Providers](https://chinmaymk.github.io/ra/providers/anthropic/)

Switch with a flag or set it in config.

```bash
ra --provider anthropic --model claude-sonnet-4-6 "Review this PR"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --provider google --model gemini-2.5-pro "Summarize this doc"
ra --provider ollama --model llama3 "Write a haiku"
ra --provider bedrock --model anthropic.claude-sonnet-4-6 "Triage this bug"
ra --provider azure --azure-deployment my-gpt4o "Analyze this log"
```

Each provider needs an API key via environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc). Bedrock and Azure fall back to their standard credential chains.

## [Tools](https://chinmaymk.github.io/ra/tools/)

Ra ships with built-in tools for filesystem operations (`Read`, `Write`, `Edit`, `AppendFile`, `LS`, `Glob`, `Grep`, `MoveFile`, `CopyFile`, `DeleteFile`), shell execution (`Bash`/`PowerShell`), web fetching (`WebFetch`), and parallelization (`Agent`). An ephemeral [scratchpad](#scratchpad) survives context compaction for plans and checklists. When [memory](#memory) is enabled, `memory_save`, `memory_search`, and `memory_forget` tools are registered for persistence across sessions.

Each tool can be independently configured, constrained, or disabled:

```yaml
agent:
  tools:
    builtin: true
    Read:
      rootDir: "./src"      # restrict reads to src/
    Write:
      rootDir: "./src"      # restrict writes to src/
    WebFetch:
      enabled: false        # disable web access
    Agent:
      maxConcurrency: 2     # limit parallel agents
```

Control what tools can do with regex-based [allow/deny rules](https://chinmaymk.github.io/ra/permissions/):

```yaml
app:
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard", "--no-verify"]
      - tool: Write
        path:
          deny: ["\\.env"]
```

## [Skills](https://chinmaymk.github.io/ra/skills/)

Reusable instruction bundles — roles, behaviors, scripts, and reference docs packaged as directories.

```bash
ra --skill code-review "Review the latest changes"
ra --skill architect "Design a queue system for email notifications"
ra --skill debugger --file crash.log "Find the root cause"
```

Ra ships with built-in skills (`code-review`, `architect`, `planner`, `debugger`, `code-style`, `writer`) and you can install more from GitHub repos, npm packages, or URLs. Each skill is a `SKILL.md` with YAML frontmatter, optional scripts, and reference docs.

```bash
ra skill install npm:ra-skill-name          # from npm
ra skill install github:user/ra-skill-name  # from GitHub
ra skill list                               # list installed skills
ra skill remove skill-name                  # uninstall
```

## [Middleware](https://chinmaymk.github.io/ra/middleware/)

Hook into every step of the agent loop with TypeScript files or inline expressions.

```ts
// middleware/token-budget.ts — stop if we've used too many tokens
export default async (ctx) => {
  if (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens > 100_000) {
    ctx.stop()
  }
}
```

Hooks are available for every phase: `beforeLoopBegin`, `beforeModelCall`, `onStreamChunk`, `afterModelResponse`, `beforeToolExecution`, `afterToolExecution`, `afterLoopIteration`, `afterLoopComplete`, and `onError`.

## [MCP Server](https://chinmaymk.github.io/ra/modes/mcp/)

Ra can run as an MCP server, turning any skill into a tool that Cursor, Claude Desktop, or other MCP-aware agents can call directly. One flag and your agent is available to other tools in your workflow.

```bash
ra --mcp-stdio --skill code-review          # expose as a stdio MCP server
ra --mcp --mcp-port 4000 --skill architect   # expose over HTTP
```

Ra also speaks MCP as a client — connect to external MCP servers and their tools become available to the model alongside the built-in ones.

## [Parallel Agents](https://chinmaymk.github.io/ra/tools/#agent)

The built-in `Agent` tool spawns parallel copies of the agent loop to work on independent tasks simultaneously. Each sub-agent gets its own context and tool access, runs to completion, and returns its result to the parent. Use it to fan out across files, run multiple investigations at once, or divide a large task into parallel workstreams.

```yaml
# allow the model to spawn up to 4 parallel agents
agent:
  tools:
    builtin: true
    Agent:
      maxConcurrency: 4
```

## [Observability](https://chinmaymk.github.io/ra/observability/)

Every model call, tool execution, and middleware hook emits structured events. Stream them to stdout, a file, or an external collector. When something goes wrong — or someone asks what the agent did — you have a complete, machine-readable trace.

```bash
ra --log-level debug --log-file agent.log "Fix the failing test"
```

Events include token usage, latency, tool inputs/outputs, and middleware decisions. Pair with the `afterLoopComplete` hook to ship traces to your observability stack.

## [Memory](https://chinmaymk.github.io/ra/tools/#memory)

SQLite-backed persistent memory that survives across sessions. The agent can store facts, decisions, and learned context — then recall them in future sessions without re-reading files or re-asking questions. Memory is scoped per-project and searchable.

```bash
ra "Remember that our API rate limit is 1000 req/min"
# later, in a new session:
ra "What's our API rate limit?"   # recalls from memory
```

## [Context Discovery](https://chinmaymk.github.io/ra/core/context-control/)

Ra automatically discovers and loads project context at startup. It finds `CLAUDE.md` files, `ra.config.yml`, and any files matching configured glob patterns — so the agent starts every session already knowing your repo's conventions, architecture, and rules.

```yaml
agent:
  context:
    patterns:
      - "CLAUDE.md"
      - "docs/architecture.md"
      - "src/**/*.prompt.md"
```

No manual copy-pasting of instructions. Check your context files into the repo and every engineer — and every agent session — gets the same baseline. Context files also support inline resolvers — `@src/auth.ts` inlines file contents and `url:https://example.com/api-docs` fetches and inlines URLs before the model sees the message.

## [Sessions](https://chinmaymk.github.io/ra/core/sessions/)

Conversations are persisted as JSONL — one message per line, easy to inspect and grep. Resume from any interface with `--resume` (latest session) or `--resume=<id>` (specific session). Sessions auto-prune by age (default 30 days) and count (default 100).

```bash
ra --resume                    # resume latest session
ra --resume=abc123             # resume specific session
ra                             # REPL: use /resume [id]
```

## [File Attachments](https://chinmaymk.github.io/ra/core/file-attachments/)

Attach images, PDFs, and text files to any prompt. Images are sent as vision content, PDFs as document blocks, and text files are inlined. Provider support varies — see the [docs](https://chinmaymk.github.io/ra/core/file-attachments/) for the full matrix.

```bash
ra --file screenshot.png "What's wrong with this UI?"
ra --file report.pdf "Summarize the key findings"
ra --file src/auth.ts --file src/routes.ts "Review these files"
```

## Interfaces

Same agent, multiple entry points.

| Interface | Flag | Use case |
|-----------|------|----------|
| **CLI** | default with a prompt | Pipe it, chain it, script it |
| **REPL** | default without a prompt | Interactive sessions with slash commands |
| **HTTP** | `--http` | Streaming SSE or sync JSON |
| **MCP** | `--mcp-stdio` / `--mcp` | Expose ra as a tool for Cursor, Claude Desktop, other agents |
| **Cron** | `--interface cron` | Run jobs on a schedule — monitoring, reports, automation |
| **Inspector** | `--inspector` | Web dashboard for debugging sessions |

Ra also speaks [MCP as a client](https://chinmaymk.github.io/ra/modes/mcp/) — connect to external MCP servers and their tools become available to the model. [Sessions](https://chinmaymk.github.io/ra/core/sessions/) are persisted as JSONL and can be resumed from any interface with `--resume`.

## [Cron](https://chinmaymk.github.io/ra/modes/cron/)

Run agent jobs on a schedule. Define jobs in your config with a name, cron expression, and prompt. Each execution creates its own session with isolated logs and traces.

```yaml
cron:
  - name: daily-report
    schedule: "0 9 * * 1-5"
    prompt: "Summarize yesterday's git activity"

  - name: health-check
    schedule: "*/30 * * * *"
    prompt: "Check API endpoints and report issues"
    agent:
      model: claude-haiku-4-5-20251001
      maxIterations: 5
```

```bash
ra --interface cron
```

Jobs can override the base agent config (model, maxIterations, thinking) or point to a recipe YAML file. The scheduler emits structured logs and tracer spans (`cron.scheduler`, `cron.job`) for full observability.

## [Recipes](https://chinmaymk.github.io/ra/recipes/)

Pre-built agent configurations you can fork and commit to your repo.

- **[Coding Agent](recipes/coding-agent/)** — file editing, shell execution, extended thinking, context compaction
- **[Code Review Agent](recipes/code-review-agent/)** — GitHub MCP, style guide, diff-gathering script, token budget middleware
- **[Auto-Research Agent](recipes/karpathy-autoresearch/)** — autonomous ML research: modifies training scripts, runs experiments, evaluates results, keeps or discards changes
- **[Multi-Agent Orchestrator](recipes/multi-agent/)** — creates and manages persistent specialist agents as independent CLI processes with resumable conversations
- **[Claude Code Agent](recipes/ra-claude-code/)** — expert software engineer with autonomous execution, debugging, refactoring, and code understanding

```bash
ra --config recipes/coding-agent/ra.config.yaml "Fix the failing test"
ra --config recipes/code-review-agent/ra.config.yaml --file diff.patch "Review this"
```

## [Configuration](https://chinmaymk.github.io/ra/configuration/)

Layered config — each layer overrides the previous.

```
defaults → config file → env vars → CLI flags
```

Supports YAML, JSON, and TOML config files (`ra.config.yml`, `ra.config.json`, `ra.config.toml`). Config is organized into `app` (infrastructure — skills, permissions, MCP, storage, observability) and `agent` (LLM behavior — provider, model, thinking, tools, middleware, compaction, context, memory).

```yaml
# ra.config.yml — all sections are optional
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  systemPrompt: You are a helpful coding assistant.
  maxIterations: 50
  thinking: medium
  skillDirs: [./skills]
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
  memory:
    enabled: true
  compaction:
    enabled: true
    threshold: 0.8
```

Environment variables are interpolated in config files with `${VAR}`, `${VAR:-default}`, and `${VAR-default}` syntax. CLI flags override everything:

```bash
ra --provider openai --model gpt-4.1 --thinking high --max-iterations 10 "Review this"
```

### Inspect

```bash
ra --show-config                                    # print resolved config as JSON
ra --show-config --provider openai --model gpt-4.1  # see how overrides merge
ra --show-context                                   # print discovered context files
ra --inspector                                      # web dashboard at localhost:3002
```

The [inspector](https://chinmaymk.github.io/ra/modes/inspector/) is a standalone web UI for debugging sessions. It shows an overview dashboard with token usage and tool stats, a timeline of every model call and tool execution, the full message history, structured logs, and trace spans. Launch it with `ra --inspector`.

## Scripting

Use `--exec` to run a TypeScript or JavaScript file that imports ra's internals programmatically.

```bash
ra --exec ./scripts/batch-review.ts
```

## [GitHub Actions](https://chinmaymk.github.io/ra/modes/github-actions/)

Use ra directly in your CI/CD workflows. No install step needed — the action downloads the binary automatically.

```yaml
- uses: chinmaymk/ra@latest
  with:
    prompt: "Review this PR for bugs and security issues"
    provider: anthropic
    model: claude-sonnet-4-6
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Documentation

This README covers the highlights. For the full reference — context discovery, compaction, observability, memory, MCP, sessions, scripting, and all configuration options — see the [docs](https://chinmaymk.github.io/ra/).

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
  <b>ra</b> — The predictable, observable agent harness.
</p>
