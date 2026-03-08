# What is ra?

ra is an open-source AI agent framework built on a simple philosophy: **get out of the model's way**. Modern LLMs are capable enough to drive complex workflows — they just need the right tools, context, and a loop that doesn't fight them. ra provides exactly that.

It's a single binary that turns any LLM — Anthropic, OpenAI, Google, Ollama, AWS Bedrock, Azure — into a tool-using agent you can run as a CLI command, an interactive REPL, a streaming HTTP API, or an MCP server. No prompt engineering gymnastics, no rigid workflow graphs. Give the model tools and context, let it work.

Every message, every tool call, every stream chunk is visible and interceptable through [middleware hooks](/middleware/). You configure agents in YAML — define tools, skills, system prompts, and context — and drop down to TypeScript only where you need custom logic.

```bash
ra "What is the capital of France?"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --skill code-review --file diff.patch "Review this diff"
cat server.log | ra "Find the root cause of these errors"
ra   # interactive REPL
```

## The config is the agent

Drop a `ra.config.yml` in a repo and that directory becomes a project-specific assistant. Set env vars for a different persona. Pass `--skill` to inject a role at runtime. Run `--mcp-stdio` to expose it as a tool for Cursor or Claude Desktop. Same binary, different agent — every time.

## What's in the box

| Feature | Description |
|---------|-------------|
| [The Agent Loop](/core/agent-loop) | Model → tools → repeat, with streaming, middleware hooks at every step, and configurable iteration limits |
| [Context Control](/core/context-control) | Smart compaction, token tracking, prompt caching, extended thinking, context discovery, pattern resolution |
| [CLI](/modes/cli) | One-shot prompts, piping, chaining, scriptable |
| [REPL](/modes/repl) | Interactive sessions with history, slash commands, file attachments |
| [HTTP API](/modes/http) | Sync and streaming chat, session management |
| [MCP](/modes/mcp) | Client (pull tools from MCP servers) and server (expose ra as a tool) |
| [Built-in Tools](/tools/) | 14 tools for filesystem, shell, network, and user interaction |
| [Skills](/skills/) | Reusable instruction bundles — roles, behaviors, scripts, and reference docs |
| [Middleware](/middleware/) | Hooks at every loop stage — intercept, modify, or stop the loop |
| [Sessions](/core/sessions) | Persist conversations as JSONL, resume from any interface, auto-prune |
| [File Attachments](/core/file-attachments) | Images, PDFs, text files — auto-detected and sent in the right format |
| [Configuration](/configuration/) | Layered: defaults → file → env → CLI. The config is the agent |

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
