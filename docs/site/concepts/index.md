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

Most AI tools lock you into one shape — a chat UI, a framework, a cloud product. ra is the opposite. It's an **agent primitive**: small, composable, and configurable enough to become whatever you need.

Give it a system prompt and it has a personality. Give it skills and it has expertise. Connect MCP servers and it has tools. Point it at a different provider and it speaks a different model. The binary never changes — only the configuration does.

That's what makes ra powerful for **agentic loops**. Drop a config file alongside your code, run `ra "do the thing"`, and you have a domain-specific agent that understands your codebase, your tools, and your workflow. Need a code reviewer? A support bot? A CI agent? Same binary, different `ra.config.yml`.

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
