# ra

One config file. Seven interfaces. Zero code changes.

ra is an autonomous AI agent that runs as a [CLI](/modes/cli), [REPL](/modes/repl), [HTTP server](/modes/http), [MCP server](/modes/mcp), [cron job](/modes/cron), [GitHub Action](/modes/github-actions), or [inspector dashboard](/modes/inspector) — all from the same binary. Give it a task and walk away. It runs to completion with no iteration caps, manages its own context, and logs everything it does. No runtime dependencies.

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

Tools like Claude Code and Aider are interactive — they're designed for a human at the keyboard. ra is designed for the opposite: long-running, unattended operation where nobody is watching. The same agent that runs in your terminal also runs as an HTTP API, an MCP server, or a cron job — with no code changes, just a flag. You get [middleware hooks](/middleware/) at every step, [regex permissions](/permissions/) per tool, structured [JSONL logs](/observability/), and a full [inspector dashboard](/modes/inspector) so that when an autonomous agent runs for 45 minutes at 2am, you can see exactly what it did.

Unlike interactive tools, ra gives you:
- **Unattended execution** — token budgets, duration limits, and adaptive thinking depth so it can run safely without supervision
- **Seven deployment modes** — CLI, REPL, HTTP, MCP, cron, GitHub Actions, inspector — same config, same agent
- **Full observability** — per-iteration token breakdown, cache hit rates, tool call frequency, complete message history
- **Middleware at every step** — intercept, modify, or deny any model call or tool execution with plain TypeScript

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

Now Cursor or Claude Desktop has a dedicated code reviewer that uses your project's style guide, your skills, your system prompt.

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

When an autonomous agent runs for 45 minutes at 2am, you need to know exactly what it did. ra is built for this.

**Token budgets and duration limits** set hard guardrails — the agent stops when it hits either, regardless of where it is in the loop. **Adaptive thinking** scales reasoning depth with the task: deep analysis early when exploring, lighter responses during routine execution. This isn't just about cost — it keeps long runs focused.

**Cache-aware compaction** manages context in long conversations. When the window fills, ra truncates from the back to keep prompt caches warm — your system prompt and early context stay cached, saving both tokens and latency. When you need semantic preservation instead, it summarizes. When a provider returns a context-length error, ra learns the real window size and adjusts automatically.

**Permissions** constrain what tools can do. Regex allow/deny rules per tool, per field. The agent can run `git commit` but not `git push --force`. It can read any file but only write to `src/`. You define the boundaries; the agent works within them.

## Context engineering

ra manages what the model sees so you don't have to.

**Automatic discovery** walks your repo for `CLAUDE.md`, `AGENTS.md`, and configured glob patterns, injecting relevant context before the first model call. **Inline resolvers** expand `@file` references and `url:` links in your prompt before the model sees them. **Dynamic file discovery** finds files near paths the model has already referenced, surfacing related context without you asking.

The three-zone compaction model — **protected** (system prompt, never removed), **compactable** (conversation history, truncated or summarized when needed), and **recent** (last few turns, always kept) — means the model always has the instructions it needs, the recent context it's working with, and as much history as fits.

Run with `--show-context` to see exactly what the model receives.

## Observability

Every action is logged automatically. No instrumentation needed.

![ra inspector dashboard showing session overview with token breakdown, tool calls, and timeline](/inspector-overview.png)

The built-in [inspector](/modes/inspector) gives you a full dashboard — per-iteration token breakdown, tool call frequency, cache hit rates, timeline of every model call and tool execution, the complete message history. Structured JSONL logs and trace spans are written per-session automatically.

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
