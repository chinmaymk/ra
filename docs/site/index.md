# ra

ra is the predictable, observable agent harness. Nothing hidden behind abstractions you can't reach. It doesn't ship with a system prompt. Every part of the loop is exposed via config and can be extended by writing scripts or plain TypeScript. [Middleware hooks](/middleware/) let you intercept every step — model calls, tool execution, streaming, all of it.

It comes with [built-in tools](/tools/) for filesystem, shell, network, and user interaction. Connect to MCP servers for additional tools. Persistent [sessions](/core/sessions) via JSONL. An FTS5 [memory](/configuration/#memory) backed by SQLite. It talks to Anthropic, OpenAI, Google, Ollama, Bedrock, and Azure. Switch providers with ease.

It speaks [MCP](/modes/mcp) both ways — use external MCP servers, or expose ra itself as an MCP server so you can use it from Cursor, Claude Desktop, or anything else that speaks the protocol.

It gives you real control over [context](/core/context-control). Deterministic discovery for common formats (CLAUDE.md, AGENTS.md, README.md), pattern resolution, prompt caching, compaction, token tracking. A [skill system](/skills/) that can pull skills from GitHub repos or npm packages.

It runs as a [CLI](/modes/cli), [REPL](/modes/repl), [HTTP server](/modes/http), or [MCP server](/modes/mcp). No runtime dependencies. Structured logs and traces per session, so you can actually see what your agent is doing.

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
```

## The config is the agent

Drop a `ra.config.yml` in a repo and that directory becomes a project-specific assistant. Set env vars for a different persona. Pass `--skill` to inject a role at runtime. Run `--mcp-stdio` to expose it as a tool for Cursor or Claude Desktop. Same binary, different agent — every time.

```yaml
# ra.config.yml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: medium

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

### CI caught a flaky test

```bash
ra --skill debugger --file test-output.log "Why is this test failing?"
```

Reads the logs, explains the root cause, and exits. Pipe the output to Slack or a PR comment.

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
| [The Agent Loop](/core/agent-loop) | Model → tools → repeat, with streaming, middleware hooks at every step, and configurable iteration limits |
| [Context Control](/core/context-control) | Smart compaction, token tracking, prompt caching, extended thinking, context discovery, pattern resolution |
| [CLI](/modes/cli) | One-shot prompts, piping, chaining, scriptable |
| [REPL](/modes/repl) | Interactive sessions with history, slash commands, file attachments |
| [HTTP API](/modes/http) | Sync and streaming chat, session management |
| [MCP](/modes/mcp) | Client (pull tools from MCP servers) and server (expose ra as a tool) |
| [Cron](/modes/cron) | Scheduled agent jobs with cron expressions and per-job config overrides |
| [Inspector](/modes/inspector) | Web dashboard for debugging sessions — traces, logs, token usage |
| [GitHub Actions](/modes/github-actions) | Run ra directly in CI/CD workflows with no install step |
| [Built-in Tools](/tools/) | Filesystem, shell, network, scratchpad, parallelization, and user interaction |
| [Skills](/skills/) | Reusable instruction bundles — install from npm, GitHub, or URLs |
| [Middleware](/middleware/) | Hooks at every loop stage — intercept, modify, or stop the loop |
| [Permissions](/permissions/) | Regex-based allow/deny rules per tool per field |
| [Sessions](/core/sessions) | Persist conversations as JSONL, resume from any interface, auto-prune |
| [File Attachments](/core/file-attachments) | Images, PDFs, and text files — provider-aware format handling |
| [Memory](/tools/#memory) | Persistent SQLite memory with FTS — save, search, forget across conversations |
| [Observability](/observability/) | Structured JSONL logs and span-based traces per session |
| [Configuration](/configuration/) | Layered: CLI > env > file, with env var interpolation and YAML/JSON/TOML support |
| [Recipes](/recipes/) | Pre-built agent configurations — coding, code review, research, multi-agent |
