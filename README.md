<h1 align="center">ra</h1>

<p align="center"><strong>The predictable, observable agent harness.</strong></p>

<p align="center">
  <a href="https://github.com/chinmaymk/ra/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://github.com/chinmaymk/ra/actions"><img src="https://img.shields.io/github/actions/workflow/status/chinmaymk/ra/ci.yml?branch=main" alt="Build"></a>
  <a href="https://github.com/chinmaymk/ra/releases"><img src="https://img.shields.io/github/v/release/chinmaymk/ra?include_prereleases" alt="Release"></a>
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#providers">Providers</a> &middot;
  <a href="#tools">Tools</a> &middot;
  <a href="#middleware">Middleware</a> &middot;
  <a href="#recipes">Recipes</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="ra demo" width="800">
</p>

---

You gave an agent a task.

It ran 20 tool calls, edited 6 files, and failed.

You have no idea why.

**ra shows you exactly what happened — and lets you stop it next time.**

```bash
ra "Fix the failing tests and open a PR"
```

```
iteration: 1
  Read: src/auth.ts
  Bash: bun test (failed)

iteration: 2
  Edit: src/auth.ts
  Bash: bun test (passed)

iteration: 3
  Bash: git commit + push
```

## Why ra

Agents fail in ways you can't see:
- silent retries
- bad tool calls
- runaway loops
- unclear costs

ra makes the loop explicit, observable, and controllable.

Not a framework. Not prompt chains. Just the loop, with control around it.

```ts
// block destructive commands before they run
export default async (ctx) => {
  if (ctx.tool.name === 'Bash' && ctx.tool.input.includes('--force')) {
    ctx.stop("Blocked")
  }
}
```

Check in your config. Everyone runs the same agent. No hidden prompts.

```yaml
# ra.config.yml — checked into your repo, reviewed in PRs
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
```

## Quick Start

```bash
export ANTHROPIC_API_KEY="sk-..."

ra "Fix the failing tests and open a PR"          # one-shot task
ra                                                 # interactive REPL
cat error.log | ra "Explain this error"            # pipe stdin
git diff | ra --skill code-review "Review this"   # pipe + skill
```

## What can you do with ra?

**Automate your dev workflow.** Fix bugs, write tests, refactor — ra reads the code, makes changes, runs the tests, and iterates until they pass.

**Research and analyze.** Pipe in logs, PDFs, or URLs. ra fetches pages, reads files, cross-references sources, and writes up findings.

```bash
ra "Compare the top 3 vector databases for a 10M-document RAG pipeline. \
    Write findings to report.md"
cat access.log | ra "Find the top 10 IPs by request count and flag anomalies"
```

**Run unattended.** Cron jobs for monitoring, reports, or triage — each run gets its own session and logs. Or plug ra into your editor as an [MCP server](https://chinmaymk.github.io/ra/modes/mcp/).

```bash
ra --interface cron
ra --mcp-stdio
```

**Build custom agents.** A single [config file](https://chinmaymk.github.io/ra/configuration/) with [skills](https://chinmaymk.github.io/ra/skills/), [middleware](https://chinmaymk.github.io/ra/middleware/), and [permissions](https://chinmaymk.github.io/ra/permissions/) turns ra into a purpose-built agent. Spawn [multiple agents](https://chinmaymk.github.io/ra/recipes/) as independent processes when one isn't enough.

## [The Agent Loop](https://chinmaymk.github.io/ra/core/agent-loop/)

Stream the response, execute tool calls in parallel, repeat. Every step fires a middleware hook.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → stream response → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → execute tools → [afterToolExecution]
  → [afterLoopIteration] → repeat or [afterLoopComplete]
```

The loop runs until the model stops calling tools — or until a guardrail fires. Token budgets, duration limits, and `maxIterations` all trigger graceful shutdown. Any middleware can call `ctx.stop()`.

## [Providers](https://chinmaymk.github.io/ra/providers/anthropic/)

Switch with a flag or set it in config.

```bash
ra --provider anthropic --model claude-sonnet-4-6 "Review this PR"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --provider google --model gemini-2.5-pro "Summarize this doc"
ra --provider ollama --model llama3 "Local-only analysis"
ra --provider bedrock --model anthropic.claude-sonnet-4-6 "Triage this bug"
ra --provider azure --azure-deployment my-gpt4o "Analyze this log"
```

Each provider needs an API key via environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, etc). Bedrock and Azure fall back to their standard credential chains.

## [Tools](https://chinmaymk.github.io/ra/tools/)

Built-in tools for filesystem (`Read`, `Write`, `Edit`, `AppendFile`, `LS`, `Glob`, `Grep`, `MoveFile`, `CopyFile`, `DeleteFile`), shell execution (`Bash`/`PowerShell`), web fetching (`WebFetch`), and parallelization (`Agent`). A [scratchpad](https://chinmaymk.github.io/ra/tools/#scratchpad) survives context compaction for plans and checklists.

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

Control what tools can do with regex-based [allow/deny rules](https://chinmaymk.github.io/ra/permissions/):

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

Ships with `code-review`, `architect`, `planner`, `debugger`, `code-style`, and `writer`. Install more from GitHub, npm, or URLs:

```bash
ra skill install github:user/ra-skill-name  # from GitHub
ra skill install npm:ra-skill-name          # from npm
ra skill list                               # list installed
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

Hooks for every phase: `beforeLoopBegin`, `beforeModelCall`, `onStreamChunk`, `afterModelResponse`, `beforeToolExecution`, `afterToolExecution`, `afterLoopIteration`, `afterLoopComplete`, `onError`.

## [MCP](https://chinmaymk.github.io/ra/modes/mcp/)

Ra speaks MCP both ways. Run as an MCP server to expose any skill as a tool for Cursor, Claude Desktop, or other agents. Connect to external MCP servers to pull in their tools.

```bash
ra --mcp-stdio                              # expose as a stdio MCP server
ra --mcp --mcp-server-port 4000             # expose over HTTP
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

## [Memory](https://chinmaymk.github.io/ra/tools/#memory)

SQLite-backed persistent memory with full-text search. The agent stores facts, decisions, and learned context — then recalls them in future sessions without re-reading files or re-asking questions.

```bash
ra "Remember that our API rate limit is 1000 req/min"
# later, in a new session:
ra "What's our API rate limit?"   # recalls from memory
```

```yaml
agent:
  memory:
    enabled: true
```

## Autonomous Operation

**Run until done.** `maxIterations` defaults to unlimited. The loop keeps going until the model stops calling tools or a resource limit fires.

**Resource guardrails.** Set a token budget or wall-clock limit — the loop finishes its current turn, logs the stop reason, and exits cleanly.

```yaml
agent:
  maxTokenBudget: 500_000   # stop after this many total tokens
  maxDuration: 600_000      # stop after 10 minutes wall-clock
```

**Adaptive thinking.** In `adaptive` mode, the agent reasons deeply in early turns — planning, architecture, tradeoffs — then lowers thinking overhead as execution progresses.

**Parallel execution.** Tool calls execute concurrently by default. The [Agent tool](https://chinmaymk.github.io/ra/tools/#agent) spawns independent sub-agents that fan out across files, investigations, or workstreams.

**Scheduled jobs.** The [cron interface](https://chinmaymk.github.io/ra/modes/cron/) runs agent jobs on a schedule — health checks, reports, triage — each with its own session, logs, and traces.

## [Observability](https://chinmaymk.github.io/ra/observability/)

Every model call, tool execution, and middleware decision emits structured events automatically. Structured JSONL logs and OpenTelemetry-style trace spans are written per-session, ready to grep or inspect in the built-in dashboard.

### [Inspector](https://chinmaymk.github.io/ra/modes/inspector/)

`ra --inspector` launches a web dashboard — total duration, iteration count, token breakdown, cache hit percentage, tool call counts, a per-iteration chart, full message history, and trace spans.

```bash
ra --inspector                  # launch the dashboard
ra --show-config                # print resolved config as JSON
ra --show-context               # print discovered context files
```

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

## [Cron](https://chinmaymk.github.io/ra/modes/cron/)

Run agent jobs on a schedule. Each execution gets its own session with isolated logs and traces.

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

## [Recipes](https://chinmaymk.github.io/ra/recipes/)

Pre-built agent configurations you can fork and commit to your repo.

- **[Coding Agent](recipes/coding-agent/)** — file editing, shell, adaptive thinking, context compaction
- **[Code Review Agent](recipes/code-review-agent/)** — GitHub MCP, style guide, diff scripts, token budget middleware
- **[Auto-Research Agent](recipes/karpathy-autoresearch/)** — autonomous ML research: run experiments, evaluate, iterate
- **[Multi-Agent Orchestrator](recipes/multi-agent/)** — persistent specialist agents as independent processes
- **[Claude Code Agent](recipes/ra-claude-code/)** — autonomous software engineer with debugging and refactoring

```bash
ra --config recipes/coding-agent/ra.config.yaml "Fix the failing test"
ra --config recipes/code-review-agent/ra.config.yaml --file diff.patch "Review this"
```

## [Configuration](https://chinmaymk.github.io/ra/configuration/)

Layered config — each layer overrides the previous.

```
defaults → config file → env vars → CLI flags
```

YAML, JSON, or TOML (`ra.config.yml`, `ra.config.json`, `ra.config.toml`). Organized into `app` (infrastructure — MCP, storage, observability) and `agent` (LLM behavior — provider, model, thinking, tools, skills, permissions, middleware, compaction, context, memory).

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

Environment variables interpolated with `${VAR}`, `${VAR:-default}`, `${VAR-default}`. CLI flags override everything:

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

## [Sessions](https://chinmaymk.github.io/ra/core/sessions/)

Conversations persist as JSONL — one message per line, easy to inspect and grep. Resume from any interface with `--resume` (latest) or `--resume=<id>` (specific).

```bash
ra --resume                    # resume latest session
ra --resume=abc123             # resume specific session
ra                             # REPL: use /resume [id]
```

## [File Attachments](https://chinmaymk.github.io/ra/core/file-attachments/)

Attach images, PDFs, and text files to any prompt.

```bash
ra --file screenshot.png "What's wrong with this UI?"
ra --file report.pdf "Summarize the key findings"
ra --file src/auth.ts --file src/routes.ts "Review these files"
```

## Scripting

Use `--exec` to run a TypeScript or JavaScript file that imports ra's internals programmatically.

```bash
ra --exec ./scripts/batch-review.ts
```

## [GitHub Actions](https://chinmaymk.github.io/ra/modes/github-actions/)

Run ra in CI/CD workflows. No install step — the action downloads the binary automatically.

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

Full reference — context discovery, compaction, observability, memory, MCP, sessions, scripting, and all configuration options — in the [docs](https://chinmaymk.github.io/ra/).

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
