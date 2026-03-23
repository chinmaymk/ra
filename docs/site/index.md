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

### Your editor needs a specialist

```bash
ra --mcp-stdio
```

Now Cursor or Claude Desktop has a dedicated code reviewer that uses your project's style guide, your skills, your system prompt.

## What's in the box

| Feature | Description |
|---------|-------------|
| [The Agent Loop](/core/agent-loop) | Model → parallel tool execution → repeat, with adaptive thinking, token budgets, duration limits, and middleware hooks at every step |
| [Context Engineering](/core/context-control) | Automatic discovery, inline `@file` and `url:` resolvers, cache-aware compaction, dynamic context window learning |
| [Observability](/observability/) | Structured JSONL logs, trace spans, per-iteration token breakdown, cache metrics — all automatic, no instrumentation needed |
| [Inspector](/modes/inspector) | Web dashboard — session overview, iteration-by-iteration breakdown, timeline, messages, logs, traces |
| [CLI](/modes/cli) | One-shot prompts, piping, chaining, scriptable |
| [REPL](/modes/repl) | Interactive sessions with history, slash commands, file attachments |
| [HTTP API](/modes/http) | Sync and streaming chat, session management |
| [MCP](/modes/mcp) | Client (pull tools from MCP servers) and server (expose ra as a tool) |
| [Cron](/modes/cron) | Scheduled autonomous jobs with cron expressions, per-job config overrides, isolated sessions |
| [GitHub Actions](/modes/github-actions) | Run ra directly in CI/CD workflows with no install step |
| [Built-in Tools](/tools/) | Filesystem, shell, network, scratchpad, parallel sub-agents |
| [Skills](/skills/) | Reusable instruction bundles — install from npm, GitHub, or URLs. The model can write new ones at runtime |
| [Middleware](/middleware/) | Hooks at every loop stage — intercept, modify, deny, or stop |
| [Permissions](/permissions/) | Regex-based allow/deny rules per tool per field |
| [Sessions](/core/sessions) | Persist conversations as JSONL, scoped per-project, resume from any interface |
| [File Attachments](/core/file-attachments) | Images, PDFs, and text files — provider-aware format handling |
| [Memory](/tools/#memory) | Persistent SQLite memory with FTS — save, search, forget across conversations |
| [Configuration](/configuration/) | Layered: CLI > env > file, with env var interpolation and YAML/JSON/TOML support |
| [Recipes](/recipes/) | Pre-built agent configurations — coding, code review, autonomous research, multi-agent orchestration |
