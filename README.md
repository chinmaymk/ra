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
  <a href="#autonomous-operation">Autonomous Operation</a> &middot;
  <a href="#providers">Providers</a> &middot;
  <a href="#tools">Tools</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#middleware">Middleware</a> &middot;
  <a href="#mcp">MCP</a> &middot;
  <a href="#observability">Observability</a> &middot;
  <a href="#interfaces">Interfaces</a> &middot;
  <a href="#recipes">Recipes</a> &middot;
  <a href="#configuration">Configuration</a>
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
  thinking: adaptive
  parallelToolCalls: true
  skillDirs:
    - ./skills
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]
```

Ra ships with a minimal default system prompt that you can override or replace entirely. Every part of the loop is exposed via config and can be extended by writing scripts or plain TypeScript. [Middleware hooks](https://chinmaymk.github.io/ra/middleware/) intercept every step — model calls, tool execution, streaming, all of it. When someone asks "what is our AI agent actually doing?" — here's the config, here's the middleware, here's the [audit log](https://chinmaymk.github.io/ra/observability/).

It talks to [multiple providers](https://chinmaymk.github.io/ra/providers/anthropic/) — Anthropic, OpenAI, Google, Ollama, Bedrock, Azure. Switch with a flag or lock it in config. Use a local Ollama model for code that shouldn't leave your machine, a frontier model when you need the reasoning. Prompt caching is automatic on providers that support it.

```bash
# Run as a coding agent in your terminal
ra "Why is this test failing?" --file test-output.log
# Expose as an MCP tool for Cursor or Claude Desktop
ra --mcp-stdio --skill code-review
# Serve a streaming HTTP API for your product
ra --http --http-port 3000
# Run scheduled jobs unattended
ra --interface cron
```

## Use Cases

Ra is a general-purpose agent loop — the same binary powers wildly different workflows depending on how you configure it.

- **Code agent** — edit files, run tests, fix bugs, review PRs. Point it at a repo with the right tools and permissions and it's a full coding assistant. Runs to completion autonomously — no iteration caps, no human-in-the-loop required.
- **Research agent** — feed it docs, URLs, or a knowledge base. Pair with web fetch and memory to build an agent that investigates questions, synthesizes sources, and remembers what it learned.
- **CI agent** — run in GitHub Actions or any CI pipeline to review PRs, enforce style, triage failing tests, or generate changelogs on every push.
- **Cron agent** — schedule recurring jobs: daily standups, health checks, report generation. Each job gets its own session, logs, and traces. Set it and forget it.
- **Documentation agent** — point it at a codebase or doc set and it can generate docs, keep them in sync with code, or answer questions grounded in the content. Use the writer skill to draft, or run it as an MCP server so other tools can query your docs through it.
- **Security agent** — audit code for vulnerabilities, enforce policies, run compliance checks. Middleware logging gives you a full audit trail of every action the agent took and why.
- **On-call agent** — pipe alerts or production logs in, let it triage and correlate. Memory means it learns from past incidents — it gets better at your system over time.
- **Multi-agent orchestrator** — spawn and manage persistent specialist agents as independent processes with resumable conversations. One agent coordinates, others execute.

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

Send messages to the model, stream the response, execute tool calls in parallel, repeat. Every step fires a middleware hook you can intercept.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → stream response → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → execute tools → [afterToolExecution]
  → [afterLoopIteration] → repeat or [afterLoopComplete]
```

The loop runs until the model stops calling tools — or until a guardrail fires. Token budgets, duration limits, and `maxIterations` all trigger graceful shutdown. Any middleware can call `ctx.stop()` to halt it. [Context compaction](https://chinmaymk.github.io/ra/core/context-control/) kicks in automatically when conversations grow — summarizing older turns with a cheap model while preserving system prompts and recent context. Tool calls within a single turn execute concurrently by default via `parallelToolCalls`.

[Extended thinking](https://chinmaymk.github.io/ra/core/context-control/) is supported at five levels (`off`, `low`, `medium`, `high`, `adaptive`) for models that support it — `adaptive` starts with deep reasoning when planning matters most and lowers thinking overhead as the loop progresses.

## Autonomous Operation

Ra is tuned for long-running, unattended agents out of the box.

**Run until done.** `maxIterations` defaults to unlimited — the loop keeps going until the model stops calling tools or a resource limit fires. No arbitrary caps.

**Resource guardrails.** Set a token budget (`maxTokenBudget`) or wall-clock limit (`maxDuration`) and the loop stops gracefully when it's reached. Both track cumulative usage across all iterations and trigger a clean stop — the agent finishes its current turn, logs the stop reason, and exits.

```yaml
agent:
  maxTokenBudget: 500_000   # stop after this many total tokens
  maxDuration: 600_000      # stop after 10 minutes wall-clock
```

**Adaptive thinking.** In `adaptive` mode, the agent reasons deeply in the early turns — when planning and architecture decisions matter most — then automatically lowers thinking overhead as execution progresses. Optional `thinkingBudgetCap` sets an absolute ceiling on thinking tokens.

**Self-healing context.** Compaction uses a [truncation strategy](https://chinmaymk.github.io/ra/core/context-control/) that drops from the back of the compactable zone, preserving the message prefix so provider prompt caches (Anthropic, OpenAI, Google) stay warm across turns. When a provider returns a context-length error, ra learns the real window size from the error, caches it, and retries — no manual configuration needed for custom or unknown models.

**Prompt caching.** System messages are automatically cache-tagged on providers that support it, cutting latency and cost for long-running sessions.

**Parallel execution.** Tool calls execute concurrently by default. The [Agent tool](https://chinmaymk.github.io/ra/tools/#agent) spawns independent sub-agents that fan out across files, investigations, or workstreams — each with its own context and tool access.

**Scheduled jobs.** The [cron interface](https://chinmaymk.github.io/ra/modes/cron/) runs agent jobs on a schedule — health checks, reports, triage — each with its own session, logs, and traces.

**Full audit trail.** Every model call, tool execution, and middleware decision is captured in structured logs and traces. When an autonomous agent runs for 45 minutes at 2am, you can [replay exactly what it did](https://chinmaymk.github.io/ra/observability/).

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

Each provider needs an API key via environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc). Bedrock and Azure fall back to their standard credential chains. Prompt caching is automatic on providers that support it.

## [Tools](https://chinmaymk.github.io/ra/tools/)

Ra ships with built-in tools for filesystem operations (`Read`, `Write`, `Edit`, `AppendFile`, `LS`, `Glob`, `Grep`, `MoveFile`, `CopyFile`, `DeleteFile`), shell execution (`Bash`/`PowerShell`), web fetching (`WebFetch`), and parallelization (`Agent`). An ephemeral [scratchpad](https://chinmaymk.github.io/ra/tools/#scratchpad) survives context compaction for plans and checklists. When [memory](https://chinmaymk.github.io/ra/tools/#memory) is enabled, `memory_save`, `memory_search`, and `memory_forget` tools are registered for persistence across sessions.

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
      maxConcurrency: 4     # limit parallel sub-agents
```

Control what tools can do with regex-based [allow/deny rules](https://chinmaymk.github.io/ra/permissions/). Middleware hooks (`beforeToolExecution`, `afterToolExecution`) let you log, time, or deny individual tool calls without stopping the loop:

```yaml
agent:
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

## [MCP](https://chinmaymk.github.io/ra/modes/mcp/)

Ra speaks MCP both ways. Run as an MCP server to expose any skill as a tool for Cursor, Claude Desktop, or other agents. Connect to external MCP servers to pull in their tools.

```bash
ra --mcp-stdio --skill code-review          # expose as a stdio MCP server
ra --mcp --mcp-server-port 4000 --skill architect   # expose over HTTP
```

```yaml
# connect to external MCP servers
app:
  mcpServers:
    - name: github
      transport: stdio
      command: npx
      args: ["-y", "@modelcontextprotocol/server-github"]
```

## [Observability](https://chinmaymk.github.io/ra/observability/)

Every model call, tool execution, and middleware hook emits structured events — token usage, latency, TTFT, cache hit rates, tool inputs/outputs, middleware decisions. Stream them to stdout, a file, or an external collector.

```bash
ra --inspector                                   # web dashboard with full traces
ra --show-config                                 # inspect resolved config
ra --show-context                                # print discovered context files
```

The [inspector](https://chinmaymk.github.io/ra/modes/inspector/) is a standalone web UI showing an overview dashboard with token usage and tool stats, a timeline of every model call and tool execution, the full message history, structured logs, and trace spans.

## Interfaces

Same agent, multiple entry points.

| Interface | Flag | Use case |
|-----------|------|----------|
| **CLI** | default with a prompt | Pipe it, chain it, script it |
| **REPL** | default without a prompt | Interactive sessions with slash commands |
| **HTTP** | `--http` | Streaming SSE or sync JSON |
| **MCP** | `--mcp-stdio` / `--mcp` | Expose ra as a tool for Cursor, Claude Desktop, other agents |
| **Cron** | `--interface cron` | Scheduled autonomous jobs — monitoring, reports, triage |
| **Inspector** | `--inspector` | Web dashboard for debugging sessions |

[Sessions](https://chinmaymk.github.io/ra/core/sessions/) are persisted as JSONL and scoped per-project. Resume from any interface with `--resume`. Attach [images, PDFs, and text files](https://chinmaymk.github.io/ra/core/file-attachments/) with `--file`. [Memory](https://chinmaymk.github.io/ra/tools/#memory) persists facts across sessions in a searchable SQLite store. [Context discovery](https://chinmaymk.github.io/ra/core/context-control/) automatically loads `CLAUDE.md` files and configured patterns at startup — so the agent starts every session already knowing your repo's conventions.

## [Cron](https://chinmaymk.github.io/ra/modes/cron/)

Run agent jobs on a schedule. Each execution creates its own session with isolated logs and traces.

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

Jobs can override the base agent config (model, maxIterations, thinking) and the scheduler emits structured logs and tracer spans for full observability.

## [Recipes](https://chinmaymk.github.io/ra/recipes/)

Pre-built agent configurations you can fork and commit to your repo.

- **[Coding Agent](recipes/coding-agent/)** — file editing, shell execution, adaptive thinking, context compaction
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

Supports YAML, JSON, and TOML config files (`ra.config.yml`, `ra.config.json`, `ra.config.toml`). Config is organized into `app` (infrastructure — MCP, storage, observability, provider credentials) and `agent` (LLM behavior — provider, model, thinking, tools, skills, permissions, middleware, compaction, context, memory).

```yaml
# ra.config.yml — all sections are optional
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  systemPrompt: You are a helpful coding assistant.
  thinking: adaptive
  parallelToolCalls: true
  maxTokenBudget: 500_000
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
    threshold: 0.7
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
