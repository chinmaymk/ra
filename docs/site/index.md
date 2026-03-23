# ra

ra is the predictable, observable agent harness — built to run autonomously. Nothing hidden behind abstractions you can't reach. Every part of the loop is exposed via config and can be extended by writing scripts or plain TypeScript. [Middleware hooks](/middleware/) let you intercept every step — model calls, tool execution, streaming, all of it.

It's designed for long-running, unattended operation. The loop runs until the task is done — no arbitrary iteration caps. [Adaptive thinking](/core/context-control) scales reasoning depth with the task. [Context compaction](/core/context-control) manages memory automatically, using a cache-aware truncation strategy that preserves prompt caches across turns. [Token budgets and duration limits](/core/agent-loop) set hard guardrails. When a provider returns a context-length error, ra learns the real window size and adjusts — no manual tuning needed.

It comes with [built-in tools](/tools/) for filesystem, shell, network, and parallelization. Tool calls execute concurrently by default. The [Agent tool](/tools/#agent) spawns independent sub-agents for parallel workstreams. Connect to [MCP servers](/modes/mcp) for additional tools — or expose ra itself as an MCP server for Cursor, Claude Desktop, or anything that speaks the protocol.

Persistent [sessions](/core/sessions) via JSONL, scoped per-project. An FTS5 [memory](/tools/#memory) backed by SQLite. Automatic [context discovery](/core/context-control) loads your repo's conventions at startup. [Prompt caching](/providers/anthropic) keeps long sessions fast and cheap. It talks to Anthropic, OpenAI, Google, Ollama, Bedrock, and Azure — switch providers with a flag.

It runs as a [CLI](/modes/cli), [REPL](/modes/repl), [HTTP server](/modes/http), [MCP server](/modes/mcp), or on a [cron schedule](/modes/cron). Structured logs and traces per session, so you can replay exactly what an autonomous agent did at 3am. No runtime dependencies.

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

### Scheduled health checks

```yaml
cron:
  - name: health-check
    schedule: "*/30 * * * *"
    prompt: "Check API endpoints and report issues"
```

Runs every 30 minutes with its own session, logs, and traces.

### You're building a feature

```bash
ra
› /attach src/auth.ts
› How should I add rate limiting to this endpoint?
```

Attach files, ask follow-ups, keep context. Resume the session tomorrow with `/resume`.

### Your product needs AI

```bash
ra --http --http-port 3000
```

POST a message, get SSE chunks back. No framework — just `Bun.serve()` under the hood.

### Your editor needs a specialist

```bash
ra --mcp-stdio --skill code-review
```

Now Cursor or Claude Desktop has a dedicated code reviewer that uses your project's style guide, your skills, your system prompt.

## What's in the box

| Feature | Description |
|---------|-------------|
| [The Agent Loop](/core/agent-loop) | Model → parallel tool execution → repeat, with adaptive thinking, token budgets, duration limits, and middleware hooks at every step |
| [Context Control](/core/context-control) | Cache-aware compaction, dynamic context window learning, prompt caching, adaptive thinking, context discovery |
| [CLI](/modes/cli) | One-shot prompts, piping, chaining, scriptable |
| [REPL](/modes/repl) | Interactive sessions with history, slash commands, file attachments |
| [HTTP API](/modes/http) | Sync and streaming chat, session management |
| [MCP](/modes/mcp) | Client (pull tools from MCP servers) and server (expose ra as a tool) |
| [Cron](/modes/cron) | Scheduled autonomous jobs with cron expressions, per-job config overrides, isolated sessions |
| [Inspector](/modes/inspector) | Web dashboard for debugging sessions — traces, logs, token usage, TTFT |
| [GitHub Actions](/modes/github-actions) | Run ra directly in CI/CD workflows with no install step |
| [Built-in Tools](/tools/) | Filesystem, shell, network, scratchpad, parallel sub-agents |
| [Skills](/skills/) | Reusable instruction bundles — install from npm, GitHub, or URLs |
| [Middleware](/middleware/) | Hooks at every loop stage — intercept, modify, deny, or stop |
| [Permissions](/permissions/) | Regex-based allow/deny rules per tool per field |
| [Sessions](/core/sessions) | Persist conversations as JSONL, scoped per-project, resume from any interface |
| [File Attachments](/core/file-attachments) | Images, PDFs, and text files — provider-aware format handling |
| [Memory](/tools/#memory) | Persistent SQLite memory with FTS — save, search, forget across conversations |
| [Observability](/observability/) | Structured JSONL logs, span-based traces, TTFT tracking, cache metrics |
| [Configuration](/configuration/) | Layered: CLI > env > file, with env var interpolation and YAML/JSON/TOML support |
| [Recipes](/recipes/) | Pre-built agent configurations — coding, code review, autonomous research, multi-agent orchestration |
