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
  <a href="#memory">Memory</a> &middot;
  <a href="#context-engineering">Context Engineering</a> &middot;
  <a href="#sessions">Sessions</a> &middot;
  <a href="#file-attachments">File Attachments</a> &middot;
  <a href="#observability">Observability</a> &middot;
  <a href="#interfaces">Interfaces</a> &middot;
  <a href="#recipes">Recipes</a> &middot;
  <a href="#configuration">Configuration</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="ra demo" width="800">
</p>

---

Ra is an agent loop you configure with a YAML file and run as a single binary. Give it a task and walk away — it manages its own context, adapts its reasoning depth, and runs until the job is done. Pipe it, chain it, cron it. Run it as a CLI, REPL, HTTP server, or MCP server. No runtime dependencies.

```bash
ra "Fix the failing tests and open a PR"
ra --provider openai --model gpt-4.1 "Refactor auth to use JWT"
cat server.log | ra "Find the root cause and patch it"
ra --interface cron   # scheduled agent jobs, unattended
ra   # interactive REPL
```

The config lives in your repo — skills, permissions, middleware — versioned and reviewable. When a new engineer clones the project, they get the same agent behavior everyone else has. When a cron job runs at 3am, it gets the same guardrails.

```yaml
# ra.config.yml — checked into your repo, reviewed in PRs
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: adaptive          # reasons deep early, gets faster as it goes
  parallelToolCalls: true     # concurrent tool execution
  maxTokenBudget: 500_000     # hard stop before burning your API budget
  skillDirs:
    - ./skills
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard"]
```

Every part of the loop is exposed via config and extensible with plain TypeScript. [Middleware hooks](https://chinmaymk.github.io/ra/middleware/) intercept every step — model calls, tool execution, streaming. [Permissions](https://chinmaymk.github.io/ra/permissions/) constrain what tools can do with regex allow/deny rules. When someone asks "what is our AI agent actually doing?" — here's the config, here's the middleware, here's the [audit log](https://chinmaymk.github.io/ra/observability/).

Because everything is plain files — skills are Markdown, middleware is TypeScript, config is YAML — the model itself can extend its own capabilities at runtime. It can write new skills, add middleware, create scripts. You set the guardrails; it builds what it needs within them.

Six [providers](https://chinmaymk.github.io/ra/providers/anthropic/) — Anthropic, OpenAI, Google, Ollama, Bedrock, Azure. Switch with a flag or lock it in config.

```bash
ra "Why is this test failing?" --file test-output.log    # coding agent
ra --mcp-stdio                                            # MCP tool for Cursor
ra --http --http-port 3000                               # streaming HTTP API
ra --interface cron                                      # scheduled jobs
```

## Use Cases

The same binary powers wildly different workflows — you just configure it differently.

**Autonomous coding agent.** Point it at a repo with the right tools and permissions. It reads the codebase, edits files, runs tests, iterates until green, opens the PR. Runs to completion — no iteration caps, no human-in-the-loop required.

```bash
ra "Fix the failing tests and open a PR"
```

**CI/CD agent.** Run in GitHub Actions to review PRs, enforce style, triage failing tests, or generate changelogs on every push. One YAML step, no install.

**Scheduled operations.** Health checks, daily reports, log triage — define jobs with cron expressions, each gets its own session and traces. Set it and forget it.

```bash
ra --interface cron
```

**Research agent.** Feed it docs, URLs, or a knowledge base. Pair with web fetch and memory to build an agent that investigates questions, synthesizes sources, and remembers what it learned across sessions.

**MCP tool for your editor.** Run `ra --mcp-stdio` and Cursor or Claude Desktop gets a dedicated agent that uses your project's config, context files, and permissions.

**Multi-agent orchestrator.** Spawn and manage persistent specialist agents as independent processes with resumable conversations. One agent coordinates, others execute.

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

Stream the response, execute tool calls in parallel, repeat. Every step fires a middleware hook.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → stream response → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → execute tools → [afterToolExecution]
  → [afterLoopIteration] → repeat or [afterLoopComplete]
```

The loop runs until the model stops calling tools — or until a guardrail fires. Token budgets, duration limits, and `maxIterations` all trigger graceful shutdown. Any middleware can call `ctx.stop()`. [Context compaction](https://chinmaymk.github.io/ra/core/context-control/) kicks in automatically when conversations grow, and tool calls within a single turn execute concurrently by default.

[Extended thinking](https://chinmaymk.github.io/ra/core/context-control/) at five levels (`off`, `low`, `medium`, `high`, `adaptive`) — `adaptive` reasons deeply when planning matters most and lowers overhead as the loop progresses.

## Autonomous Operation

Ra is tuned for long-running, unattended agents out of the box.

**Run until done.** `maxIterations` defaults to unlimited. The loop keeps going until the model stops calling tools or a resource limit fires. No arbitrary caps.

**Resource guardrails.** Set a token budget (`maxTokenBudget`) or wall-clock limit (`maxDuration`) — the loop finishes its current turn, logs the stop reason, and exits cleanly.

```yaml
agent:
  maxTokenBudget: 500_000   # stop after this many total tokens
  maxDuration: 600_000      # stop after 10 minutes wall-clock
```

**Adaptive thinking.** In `adaptive` mode, the agent reasons deeply in early turns — planning, architecture, tradeoffs — then lowers thinking overhead as execution progresses. `thinkingBudgetCap` sets an absolute ceiling on thinking tokens.

**Self-healing context.** Compaction uses a [truncation strategy](https://chinmaymk.github.io/ra/core/context-control/) that drops from the back of the compactable zone, keeping the message prefix byte-identical so provider prompt caches stay warm across turns. When a provider returns a context-length error, ra parses the real window size from the error, caches it, and retries — no manual configuration for custom or unknown models.

**Cache-aware by design.** Ra actively maximizes cache hits across providers. For Anthropic, it injects `cache_control` markers on system messages, the last two user turns, and tool definitions. For all providers, the truncation-first compaction strategy preserves prefix continuity — the part that prefix-caching providers (Anthropic, OpenAI, Google) actually cache. Long sessions get cheaper over time, not more expensive.

**Parallel execution.** Tool calls execute concurrently by default. The [Agent tool](https://chinmaymk.github.io/ra/tools/#agent) spawns independent sub-agents that fan out across files, investigations, or workstreams.

**Scheduled jobs.** The [cron interface](https://chinmaymk.github.io/ra/modes/cron/) runs agent jobs on a schedule — health checks, reports, triage — each with its own session, logs, and traces.

**Full audit trail.** Every model call, tool execution, and middleware decision is captured in structured logs and traces. When an autonomous agent runs for 45 minutes at 2am, you can [see exactly what it did](https://chinmaymk.github.io/ra/observability/).

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

SQLite-backed persistent memory with full-text search. The agent stores facts, decisions, and learned context — then recalls them in future sessions without re-reading files or re-asking questions. Scoped per-project.

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

When enabled, `memory_save`, `memory_search`, and `memory_forget` tools are registered automatically.

## [Context Engineering](https://chinmaymk.github.io/ra/core/context-control/)

Ra gives you full control over what the model sees and when. Context isn't just "stuffed in" — it's discovered, resolved, compacted, and cached through a layered system you can inspect and override at every step.

**Automatic discovery.** At startup, ra walks from the working directory up to the git root, loading `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`, and any files matching your configured glob patterns. During the loop, it dynamically discovers context files near paths the model references — when the agent reads `src/auth/middleware.ts`, ra automatically loads `src/auth/CLAUDE.md` if it exists.

```yaml
agent:
  context:
    patterns:
      - "CLAUDE.md"
      - "docs/architecture.md"
      - "src/**/*.prompt.md"
    subdirectoryWalk: true     # discover context near referenced files (default)
```

**Pattern resolvers.** Inline references in prompts and context files are resolved before the model sees the message. `@src/auth.ts` inlines file contents. `@src/**/*.ts` expands globs. `url:https://example.com/api-docs` fetches and inlines URLs. `/skill-name` lazy-loads a skill. All resolvers run in parallel with deduplication — reference the same file twice and it's only resolved once.

**Context compaction.** When conversations grow toward the context window, ra splits messages into three zones — pinned (system + first user message), compactable (middle turns), and recent (last 20% by token count). The default strategy truncates from the back of the compactable zone, keeping the prefix byte-identical for prompt caching. A summarization fallback is available for cases where you need to preserve more semantic context. If the context window size isn't known (custom models, new providers), ra learns it from the first provider error and caches it for future runs.

```bash
ra --show-context   # see exactly what context files ra discovered and loaded
```

## [Sessions](https://chinmaymk.github.io/ra/core/sessions/)

Conversations persist as JSONL — one message per line, easy to inspect and grep. Scoped per-project so multiple repos maintain separate histories. Resume from any interface with `--resume` (latest) or `--resume=<id>` (specific). Auto-prune by age and count.

```bash
ra --resume                    # resume latest session
ra --resume=abc123             # resume specific session
ra                             # REPL: use /resume [id]
```

## [File Attachments](https://chinmaymk.github.io/ra/core/file-attachments/)

Attach images, PDFs, and text files to any prompt. Images are sent as vision content, PDFs as document blocks, text files are inlined.

```bash
ra --file screenshot.png "What's wrong with this UI?"
ra --file report.pdf "Summarize the key findings"
ra --file src/auth.ts --file src/routes.ts "Review these files"
```

## [Observability](https://chinmaymk.github.io/ra/observability/)

Every model call, tool execution, and middleware decision emits structured events automatically. No instrumentation code required — ra logs and traces everything by default. Structured JSONL logs and OpenTelemetry-style trace spans are written per-session, ready to grep, stream to a collector, or inspect in the built-in dashboard.

### [Inspector](https://chinmaymk.github.io/ra/modes/inspector/)

`ra --inspector` launches a web dashboard that lets you browse and debug any session. The overview shows total duration, iteration count, token breakdown (input, output, thinking, cache), cache hit percentage, tool call and error counts, loop status — plus a per-iteration chart showing exactly how tokens were spent across the run. Drill into the timeline for a chronological stream of every model call and tool execution, or the full message history to see what the model saw and said at each turn. Structured logs and hierarchical trace spans round out the picture.

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
