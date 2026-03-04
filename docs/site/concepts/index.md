# What is ra?

> **ra** is a **r**aw **a**gent. A **r**ole **a**gent. A **r**un-**a**nything **a**gent.
>
> One binary you configure into whatever agent you need — without rewriting anything.

Same binary. Different config. Different agent.

- Drop a `ra.config.yml` in a repo → a project-specific assistant with its own system prompt, skills, and tools
- Set env vars → a different provider, a different persona, the same CLI
- Pass `--skill` → inject a role or behavior at runtime
- Run `--mcp` → expose it as a tool to Cursor, Claude Desktop, or anything MCP-aware

## Why ra?

Most AI tools are single-purpose. A CLI that can't become an API. A framework locked to one provider. A chat UI you can't automate. You end up wiring together different tools for different contexts — each with its own config, its own auth, its own quirks.

ra is one binary that adapts to where you need it.

### CI caught a flaky test

Your pipeline fails at 3am. Add one step:

```bash
ra --skill debugger --file test-output.log "Why is this test failing?"
```

It reads the logs, explains the root cause, and exits. Pipe the output to Slack, write it to a PR comment, or just read it in the morning.

### You're building a feature

Drop into the REPL and think out loud:

```bash
ra
› /attach src/auth.ts
› How should I add rate limiting to this endpoint?
```

Attach files, ask follow-ups, keep context. Resume the session tomorrow with `/resume`.

### Your product needs AI

Start a streaming API server:

```bash
ra --http --http-port 3000
```

POST a message, get SSE chunks back. No Express, no framework — just `Bun.serve()` under the hood.

### Your editor needs a specialist

Run ra as an MCP server and Cursor or Claude Desktop can call it directly:

```bash
ra --mcp --skill code-review
```

Now your editor has a dedicated code reviewer that uses your project's style guide, your skills, your system prompt.

---

Same config. Same skills. Same binary. The interface changes, the agent doesn't.

## What's in the box

| Feature | Description |
|---------|-------------|
| **REPL** | Interactive sessions with history |
| **One-shot CLI** | Scriptable prompts, streams to stdout |
| **HTTP API** | Sync + streaming chat, session management |
| **MCP client** | Pull tools from other MCP servers |
| **MCP server** | Expose ra as a tool to other apps |
| **Tool calling** | Model invokes functions, ra executes them |
| **Skills** | Reusable instruction bundles — roles, behaviors, and assets |
| **File attachments** | Attach files in CLI and REPL |
| **Session storage** | Persist conversations, resume later, auto-prune old ones |
| **Layered config** | File → env → CLI override order; commit a baseline, tweak per-run |
