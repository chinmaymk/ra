# ra

> **ra is a raw AI agent** you run as a standalone binary—minimal by default, molded to any task. Same interface for Anthropic, OpenAI, Google, and Ollama; you shape it with skills, tools, config, and MCP. Swap providers, switch interfaces (REPL, CLI, HTTP, MCP), or plug in new capabilities without rewriting your workflow.

<br>

### Out of the box

| Feature | Description |
|---------|-------------|
| **REPL** | Interactive sessions with history |
| **One-shot CLI** | Scriptable prompts, streams to stdout |
| **HTTP API** | Sync + streaming chat, session list |
| **MCP client** | Pull tools from other MCP servers |
| **MCP server** | Expose ra as a tool to other apps |
| **Tool calling** | Model invokes functions, ra runs them |
| **Skills** | Reusable instruction bundles (scripts + assets) |
| **File attachments** | CLI and REPL |
| **Session storage** | Persist, resume, auto-prune |
| **Layered config** | File → env → CLI override order; one baseline, clear precedence |

<br>

### Table of contents

- [Why would you use ra?](#why-would-you-use-ra)
- [Install](#install)
- [Use it](#use-it)
- [REPL](#repl)
- [HTTP API](#http-api)
- [MCP](#mcp)
- [Layered config](#layered-config)

---

### Why would you use ra?

ra is a **raw agent**: one core that you mold to the task. Use the REPL for exploration, the CLI for scripts, HTTP for your app, or MCP so other tools can call it. Add skills for behavior, attach tools via MCP, set system prompt and provider in config—same binary, different shapes. When a provider is rate-limited or down, flip `RA_PROVIDER`. Sessions persist so you can resume; layered config (file → env → CLI) keeps team baseline and one-off overrides clear. No fixed product; you decide what it does.

---

### Install

Grab the `ra` binary for your OS. Put it somewhere on your `PATH`. Done.

```bash
mv ra /usr/local/bin/ra
chmod +x /usr/local/bin/ra
ra --help
```

If `ra --help` prints something, you’re in.

---

### Use it

One-off question:

```bash
ra "What is the capital of France?"
```

Pick provider/model, attach a file, or slap on a skill:

```bash
ra --provider openai --model gpt-4.1-mini "Explain this error"
ra --file report.pdf "Summarize in three bullets."
ra --skill code-review --file diff.patch "Review this diff."
```

Streams to stdout and exits. Script it, pipe it, forget it.

---

### REPL

```bash
ra
```

You get a `›` prompt. Type. It streams back, runs tools, saves the convo.

| Command | Description |
|--------|-------------|
| `/clear` | Clear history, start fresh |
| `/resume <session-id>` | Load and continue a session |
| `/skill <name>` | Inject a skill with your next message |
| `/attach <path>` | Attach a file to your next message |

---

### HTTP API

```bash
ra --http
```

Listens on your configured port (default `3000`). Optional Bearer token in config.

| Method + path | Description |
|---------------|-------------|
| `POST /chat/sync` | JSON body `{ "messages": [...] }` → `{ "response": "..." }` |
| `POST /chat` | Same, but SSE stream: `data: {"type":"text","delta":"..."}` then `data: {"type":"done"}` |
| `GET /sessions` | List stored sessions |

When a token is set, send: `Authorization: Bearer <token>`.

---

### MCP

| Mode | What it does |
|-----|----------------|
| **Use other people’s tools** | Add MCP clients in config. ra connects, lists their tools, registers them. The model calls them like any other tool. |
| **Be the tool** | `ra --mcp` exposes ra as one MCP tool that takes a prompt and runs the agent. Other apps can call you. |

---

### Layered config

**defaults → file → env → CLI.** Each layer overrides the previous. So: commit a `ra.config.json` (or `.yaml` / `.toml`) for the team baseline; use env for per-environment behavior and secrets; use CLI flags when you need a one-off. No surprise precedence.

- **File** (cwd): `ra.config.json`, `ra.config.yaml`, `ra.config.yml`, or `ra.config.toml`
- **Env:** `RA_PROVIDER`, `RA_MODEL`, `RA_SYSTEM_PROMPT`, `RA_MAX_ITERATIONS`
- **CLI:** `--provider`, `--model`, `--system-prompt`, etc. override everything.

---

> *ra: a raw agent you mold to any task. One binary, four providers, zero lock-in.*
