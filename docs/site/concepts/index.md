# What is ra?

ra is an open-source AI agent framework that gives you full control over the agentic loop. It's a single binary that turns any LLM — Anthropic, OpenAI, Google, Ollama, AWS Bedrock, Azure — into a tool-using agent you can run as a CLI command, an interactive REPL, a streaming HTTP API, or an MCP server.

Every message, every tool call, every stream chunk is visible and interceptable through middleware hooks. You configure agents in YAML — define tools, skills, system prompts, and context — and drop down to TypeScript only where you need custom logic.

```bash
ra "What is the capital of France?"
ra --provider openai --model gpt-4.1 "Explain this error"
ra --skill code-review --file diff.patch "Review this diff"
cat server.log | ra "Find the root cause of these errors"
ra   # interactive REPL
```

## Same binary, different agent

The config is the agent. Change the config, change the agent.

- Drop a `ra.config.yml` in a repo — a project-specific assistant with its own system prompt, skills, and tools
- Set env vars — a different provider, a different persona, the same CLI
- Pass `--skill` — inject a role or behavior at runtime
- Run `--mcp-stdio` — expose it as a tool for Cursor, Claude Desktop, or anything MCP-aware

## What's in the box

| Feature | Description |
|---------|-------------|
| [**The Agent Loop**](/core/agent-loop) | Model → tools → repeat, with streaming, middleware hooks at every step, and configurable iteration limits |
| [**Context Control**](/core/context-control) | Smart compaction, token tracking, prompt caching, extended thinking, context discovery, pattern resolution |
| [**CLI**](/modes/cli) | One-shot prompts, piping, scriptable |
| [**REPL**](/modes/repl) | Interactive sessions with history, slash commands, file attachments |
| [**HTTP API**](/modes/http) | Sync + streaming chat, session management |
| [**MCP**](/modes/mcp) | Client (pull tools from MCP servers) and server (expose ra as a tool) |
| [**Built-in Tools**](/tools/) | 14 tools for filesystem, shell, network, and user interaction |
| [**Skills**](/skills/) | Reusable instruction bundles — roles, behaviors, scripts, and reference docs |
| [**Middleware**](/middleware/) | Hooks at every loop stage — intercept, modify, or stop the loop |
| [**Sessions**](/core/sessions) | Persist conversations, resume later, auto-prune |
| [**File Attachments**](/core/file-attachments) | Images, PDFs, text files — auto-detected and sent in the right format |
| [**Layered Config**](/configuration/) | defaults → file → env → CLI override order |

## Why ra?

Most agent frameworks give you a locked-down loop you can't inspect or modify. Most CLI tools give you prompt-in, text-out with no agent capabilities. ra gives you both — a real agentic loop that's fully extensible through config, skills, middleware, and MCP.

### CI caught a flaky test

```bash
ra --skill debugger --file test-output.log "Why is this test failing?"
```

It reads the logs, explains the root cause, and exits. Pipe the output to Slack or a PR comment.

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

POST a message, get SSE chunks back. No Express, no framework — just `Bun.serve()` under the hood.

### Your editor needs a specialist

```bash
ra --mcp-stdio --skill code-review
```

Now Cursor or Claude Desktop has a dedicated code reviewer that uses your project's style guide, your skills, your system prompt.
