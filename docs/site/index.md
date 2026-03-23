# ra

ra is an open-source agent harness — give it a task, point it at an LLM, and let it work. It reads files, runs commands, calls APIs, and loops until the job is done. You stay in control through a simple config file that defines what the agent can and can't do.

## What can you build with ra?

**Automate your dev workflow.** Point ra at your codebase and tell it to fix a bug, write tests, or refactor a module. It reads the code, makes changes, runs the tests, and iterates until they pass — all without you watching.

**Debug issues faster.** Pipe a log file or error trace into ra and get an explanation in seconds. Chain it with `--skill` to apply specialized analysis like code review or security auditing.

**Run agents on a schedule.** Set up cron jobs that monitor your APIs, check for stale dependencies, or generate daily reports — each run gets its own session and logs.

**Plug into your editor.** Run ra as an [MCP server](/modes/mcp) and connect it to Cursor, Claude Desktop, or any MCP-compatible tool. Your editor gets a specialist that knows your project's conventions.

**Build custom agents.** A single config file turns ra into a purpose-built agent. Add [skills](/skills/) (reusable instruction sets), [middleware](/middleware/) (hooks that intercept every step), and [permissions](/permissions/) (rules that constrain what tools can do). Everything is plain files — YAML config, Markdown skills, TypeScript middleware — so the agent itself can extend its own capabilities at runtime.

## Why ra?

- **Predictable.** No magic. The [agent loop](/core/agent-loop) is explicit: call the model, execute tools, repeat. [Middleware hooks](/middleware/) let you intercept, modify, or block any step.
- **Observable.** Every run produces structured logs, trace spans, and token metrics. The built-in [inspector](/modes/inspector) shows you exactly what the agent did — every model call, tool execution, and decision.
- **Runs anywhere.** Use it as a [CLI](/modes/cli), [REPL](/modes/repl), [HTTP server](/modes/http), [MCP server](/modes/mcp), or [cron job](/modes/cron). Works with Anthropic, OpenAI, Google, Ollama, Bedrock, and Azure — switch providers with a flag.
- **No limits on autonomy.** The loop runs until the task is done — no arbitrary iteration caps. [Token budgets](/core/agent-loop) and [duration limits](/core/agent-loop) set the guardrails you choose.

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
