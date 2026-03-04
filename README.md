# ra

> **ra** is a **r**aw **a**gent. A **r**ole **a**gent. A **r**un-**a**nything **a**gent.
>
> One binary you configure into whatever agent you need — without rewriting anything.

Same binary. Different config. Different agent.

- Drop a `ra.config.yml` in a repo → a project-specific assistant with its own system prompt, skills, and tools
- Set env vars → a different provider, a different persona, the same CLI
- Pass `--skill` → inject a role or behavior at runtime
- Run `--mcp` → expose it as a tool to Cursor, Claude Desktop, or anything MCP-aware

No wrappers. No frameworks. Just config.

<br>

### Why ra?

Most AI tools lock you into one shape — a chat UI, a framework, a cloud product. ra is the opposite. It's an **agent primitive**: small, composable, and configurable enough to become whatever you need.

Give it a system prompt and it has a personality. Give it skills and it has expertise. Connect MCP servers and it has tools. Point it at a different provider and it speaks a different model. The binary never changes — only the configuration does.

That's what makes ra powerful for **agentic loops**. Drop a config file alongside your code, run `ra "do the thing"`, and you have a domain-specific agent that understands your codebase, your tools, and your workflow. Need a code reviewer? A support bot? A CI agent? Same binary, different `ra.config.yml`.

**Five providers, one interface.** Anthropic, OpenAI, Google Gemini, Ollama, AWS Bedrock. Rate-limited on one? Flip `RA_PROVIDER` and keep going. Want to run locally? Point it at Ollama. Same config, different backend — no code changes.

**Four ways to run it.** Each one serves a different context:

- **One-shot CLI** — scriptable prompts that stream to stdout and exit. Pipe it, chain it, cron it.
- **Interactive REPL** — conversational sessions with history, tool use, and file attachments.
- **HTTP server** — sync and streaming endpoints your application talks to directly.
- **MCP server** — expose ra as a callable tool so Cursor, Claude Desktop, or your own agents can use it.

And ra is also an **MCP client** — it connects to other MCP servers to pull in their tools, so the model can call databases, filesystems, APIs, or anything else someone has exposed over MCP.

<br>

### What's in the box

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

<br>

### Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [REPL](#repl)
- [HTTP API](#http-api)
- [MCP](#mcp)
- [Layered config](#layered-config)

---

### Install

Grab the `ra` binary for your OS. Put it somewhere on your `PATH`. Done.

```bash
mv ra /usr/local/bin/ra
chmod +x /usr/local/bin/ra
ra --help
```

If `ra --help` prints something, you're in.

---

### Quick start

One-off question:

```bash
ra "What is the capital of France?"
```

Pick a provider and model, attach a file, or inject a skill:

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

You get a `›` prompt. Type. It streams back, runs tools, saves the conversation.

| Command | Description |
|--------|-------------|
| `/clear` | Clear history, start fresh |
| `/resume <session-id>` | Load and continue a previous session |
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
| `POST /chat` | Same body, but streams via SSE: `data: {"type":"text","delta":"..."}` then `data: {"type":"done"}` |
| `GET /sessions` | List stored sessions |

When a token is set, send `Authorization: Bearer <token>`.

---

### MCP

ra speaks MCP in both directions.

| Mode | What it does |
|-----|----------------|
| **ra uses tools** | Add MCP server configs and ra connects to them, discovers their tools, and registers them. The model calls them like any other function. |
| **ra is the tool** | Run `ra --mcp` and ra exposes itself as a single MCP tool that takes a prompt and runs the full agent loop. Other apps — Cursor, Claude Desktop, your own agents — can call it. |

---

### Layered config

**defaults → file → env → CLI.** Each layer overrides the previous. No surprise precedence.

Commit a `ra.config.yml` for a team or project baseline. Use environment variables for secrets and per-environment behavior. Use CLI flags when you need a one-off override.

- **File** (cwd): `ra.config.json`, `ra.config.yaml`, `ra.config.yml`, or `ra.config.toml`
- **Env:** `RA_PROVIDER`, `RA_MODEL`, `RA_SYSTEM_PROMPT`, `RA_MAX_ITERATIONS`
- **CLI:** `--provider`, `--model`, `--system-prompt`, etc. — overrides everything.

**Provider credentials** (env only — not exposed as CLI flags, to keep them out of shell history):

| Provider | Env var(s) |
|----------|-----------|
| Anthropic | `RA_ANTHROPIC_API_KEY`, `RA_ANTHROPIC_BASE_URL` |
| OpenAI | `RA_OPENAI_API_KEY`, `RA_OPENAI_BASE_URL` |
| Google | `RA_GOOGLE_API_KEY` |
| Ollama | `RA_OLLAMA_HOST` |
| Bedrock | `RA_BEDROCK_API_KEY`, `RA_BEDROCK_REGION` |

For Bedrock, `RA_BEDROCK_API_KEY` sets a Bearer token. If omitted, ra falls back to the standard AWS credential chain (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `~/.aws/credentials`, IAM roles, etc.).

---

> *ra: raw agent, role agent, run-anything agent. One binary, any shape, zero lock-in.*
