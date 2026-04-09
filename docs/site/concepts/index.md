# What is ra?

ra is an agent runtime — a single binary that streams a conversation between an LLM and a set of tools, runs whatever tool calls the model emits, feeds the results back, and loops until the job is done. That's the entire core. Everything else on this page — providers, tools, middleware, skills, sessions, memory, MCP, the inspector — is built around making that loop yours to shape.

The runtime ships without opinions. There's no default system prompt, no fixed model, no preset toolset. You assemble an agent by writing a config file (`ra.config.yml`, `.json`, or `.toml`) that picks the model, enables tools, declares permissions, and points at any middleware or skills you want to load. Same binary, different config, completely different agent.

```bash
ra "What is the capital of France?"               # one-shot prompt
git diff | ra "Review this for security issues"  # piped input
ra --provider openai --model gpt-4.1 "..."        # override per call
ra                                                 # interactive REPL
ra --http --http-port 3000                         # streaming HTTP server
```

The rest of this page walks through ra section by section: how the loop runs, what the config controls, which providers and tools are available, how middleware extends the loop, how state persists, and how to actually run an agent.

## The agent loop

The loop lives in `packages/ra/src/agent/loop.ts` and does five things per iteration:

1. **Stream** the next response from the configured provider
2. **Accumulate** text chunks and tool calls as they arrive
3. **Append** the assistant message to the conversation history
4. **Execute** any tool calls (in parallel by default; sequentially if `parallelToolCalls: false`)
5. **Append** tool results and start the next iteration

The loop terminates when the model returns a response with no tool calls, when `maxIterations` is hit, when the configured token budget is exhausted, or when wall-clock duration runs out. Streaming is end-to-end — chunks reach your terminal (or HTTP client, or MCP consumer) as they're generated, and middleware can intercept every chunk in flight.

You set the budgets in config:

```yaml
agent:
  maxIterations: 100
  maxTokenBudget: 500_000   # hard cap on total token spend
  maxDuration: 600_000      # max wall-clock time in ms
```

[Agent loop reference →](/core/agent-loop)

## Configuration

A `ra.config.yml` is the full definition of an agent. ra discovers it by walking up from the current directory looking for `ra.config.yaml`, `ra.config.yml`, `ra.config.json`, or `ra.config.toml` — whichever it finds first becomes the agent for that directory.

```yaml
# ra.config.yml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: adaptive       # off | low | medium | high | adaptive
  maxTokenBudget: 500_000
  skillDirs: [./skills]
  middleware:
    afterToolExecution:
      - ./middleware/audit-log.ts
  memory:
    enabled: true

permissions:
  rules:
    - tool: Bash
      command:
        allow: ["^git ", "^bun "]
        deny: ["--force", "--no-verify"]
    - tool: Write
      path:
        deny: ["\\.env", "secrets"]
```

Configuration is **layered**: built-in defaults are overridden by recipe presets, which are overridden by your config file, which are overridden by CLI flags. Set a provider in config, switch it for one call with `--provider openai`. Keep a base config in your repo and override individual fields in CI. The lower layers stay intact — there's no merge magic to reason about.

[Configuration reference →](/configuration/)

## Providers

ra has nine provider implementations under the hood, covering the LLM landscape most teams need to reach:

| Provider | Notes |
|----------|-------|
| **Anthropic** | Claude models, with extended thinking and prompt caching |
| **OpenAI** | GPT models via the responses API |
| **OpenAI-Completions** | Anything that speaks the OpenAI completions API — used by OpenRouter, LiteLLM, vLLM, and friends |
| **Codex** | Sign in with your existing Codex CLI subscription |
| **Anthropic Agents SDK** | The hosted agents API |
| **Google** | Gemini |
| **Bedrock** | Any model AWS hosts |
| **Azure** | OpenAI deployments on Azure |
| **Ollama** | Anything you run locally |

Bring your own API key, or sign in with an existing **Anthropic** or **OpenAI / Codex** subscription — ra reuses the OAuth tokens those CLIs already manage. Switch providers per invocation with `--provider`, or pin one in config.

`thinking: adaptive` is one knob worth knowing about: ra runs the model with high reasoning effort for the first ten turns, then drops to low for the rest. That's usually the right shape for an agent that has to plan hard upfront and then execute mechanically.

[All providers →](/providers/anthropic)

## Tools

Tools are how the agent reaches outside the model. ra ships with a focused set of built-ins:

| Tool | What it does |
|------|--------------|
| `Read`, `Write`, `Edit`, `AppendFile` | File I/O |
| `LS`, `Glob`, `Grep` | Filesystem traversal and content search |
| `MoveFile`, `CopyFile`, `DeleteFile` | File management |
| `Bash` (or `PowerShell` on Windows) | Shell execution |
| `WebFetch` | HTTP requests |

Each tool can be enabled, disabled, or constrained per agent. **Permissions** use a regex allow/deny system — no DSL, just patterns the tool input is matched against. The example in the config above blocks `--force` and `--no-verify` from any `Bash` invocation, and prevents `Write` from touching anything matching `\.env` or `secrets`.

**Custom tools** are a TypeScript function or a script in any language. You register them in config; the model picks them up alongside built-ins through the same schema mechanism.

[Tools reference →](/tools/) · [Custom tools →](/tools/custom)

## Skills

A **skill** is a reusable instruction bundle: a markdown prompt plus optional supporting files (reference docs, schemas, helper scripts). When the model decides a skill is relevant to the task, ra loads it on demand and injects its contents into the context — so you don't pay tokens for skills the model doesn't need.

Skills can live anywhere:

```bash
ra skill install user/repo                  # GitHub
ra skill install npm:@company/code-review   # npm package
ra skill install https://...                # arbitrary URL
ra skill list
```

Or just point `skillDirs` at a local folder and drop markdown files in.

[Skills reference →](/skills/)

## Middleware

Middleware is how you extend the loop without forking it. ra exposes nine well-defined hook points; middleware functions read, mutate, or stop the flow at any of them:

| Hook | Fires when |
|------|-----------|
| `beforeLoopBegin` | Once, before the first iteration |
| `beforeModelCall` | Before each request to the provider |
| `onStreamChunk` | For every chunk the provider streams back |
| `afterModelResponse` | After a complete model response is received |
| `beforeToolExecution` | Before each tool call runs |
| `afterToolExecution` | After each tool call completes |
| `afterLoopIteration` | At the end of every iteration |
| `afterLoopComplete` | When the loop terminates |
| `onError` | On any thrown error |

Each middleware is a function that receives the loop context and can short-circuit the loop:

```ts
// middleware/audit.ts — log every tool call
export default async (ctx) => {
  const { name, arguments: args } = ctx.toolCall
  ctx.logger.info('tool', { name, args })
}
```

Wire it in config:

```yaml
agent:
  middleware:
    afterToolExecution:
      - ./middleware/audit.ts
```

Many of ra's own features are implemented this way — token budgeting, automatic compaction, retry logic, prompt caching. Yours run on the same infrastructure.

[Middleware reference →](/middleware/)

## Sessions and memory

A **session** is the persisted history of one conversation. Every message, tool call, and model response is written to a JSONL file at `~/.ra/<agent>/sessions/<uuid>/messages.jsonl` as it happens, alongside structured logs and trace spans. You can resume any session from any interface — start in the CLI, continue in the REPL, finish over HTTP — and the full context comes with you.

**Memory** is different. It's a SQLite database with FTS5 full-text search that the agent can read from and write to *across* sessions. Use it for facts the agent should remember between conversations: project conventions, previous decisions, things the user has told it before.

```yaml
agent:
  memory:
    enabled: true
```

[Sessions →](/core/sessions) · [Memory →](/configuration/#agent-memory)

## MCP, both ways

ra speaks the [Model Context Protocol](https://modelcontextprotocol.io) in both directions:

- **As a client**, ra connects to any MCP server declared in config and surfaces its tools to the model under server-prefixed names. They go through the same permission system as built-in tools.
- **As a server**, ra exposes itself. Run `ra --mcp-stdio` and Cursor, Claude Desktop, or any other MCP-aware client gets a fully-configured ra agent it can call into.

This is what makes ra composable. You can run ra inside ra, expose a domain-specialist ra to a generalist ra, or wrap your custom recipe and hand it to your editor.

[MCP reference →](/modes/mcp)

## Interfaces

The same configured agent runs in any of these shapes — the loop is the same, only the I/O shell changes:

| Mode | Command | Use case |
|------|---------|----------|
| **CLI** | `ra "prompt"` | One-shot prompts, piping, scripting |
| **REPL** | `ra` | Interactive sessions with slash commands and file attachments |
| **HTTP** | `ra --http` | Streaming chat API with session management |
| **MCP** | `ra --mcp-stdio` | Expose to Cursor, Claude Desktop, other agents |
| **Cron** | `ra --interface cron` | Scheduled autonomous jobs |
| **Inspector** | `ra --inspector` | Web dashboard for traces and history |

## Observability

Every model call, tool execution, and decision is captured automatically. ra writes structured JSONL logs and per-session trace spans to disk — no setup required. Open the **Inspector** to browse them:

```bash
ra --inspector
```

It boots a local web dashboard (default port 3002) that renders iterations, token spend, tool calls, the complete message history, and any errors that fired along the way. Useful for debugging an agent run, or for showing a teammate exactly what the model did and why.

[Observability →](/observability/)

## Recipes

A **recipe** is a complete agent definition — config, middleware, skills, custom tools — packaged as a folder you can run directly:

```bash
ra --config recipes/oh-my-ra "Refactor the auth module and write tests"
```

ra ships with several built-in recipes:

- **coding-agent** — read-before-write discipline, memory, high thinking
- **code-review-agent** — token-budgeted reviewer with severity tiers
- **karpathy-autoresearch** — long-running experiments and evaluations
- **multi-agent** — orchestrator that spawns specialist sub-agents
- **oh-my-ra** — batteries-included: coding + research + debugging + delivery
- **auto-improve** — hyperparameter and prompt optimization
- **ra-claude-code** — coding agent inspired by Claude Code

Recipes are just configs. Copy one, modify it, commit your version — same way you'd fork a starter template.

## Use cases

### Triage a flaky test

```bash
cat test-output.log | ra "Why is this test failing? Find the root cause."
```

Reads the logs, explains the root cause, and exits. Pipe the output to Slack or a PR comment.

### Review a diff before pushing

```bash
git diff | ra "Review this diff for security issues and obvious bugs"
```

### Multi-turn feature design

```bash
ra
› /attach src/auth.ts
› How should I add rate limiting to this endpoint?
```

Attach files, ask follow-ups, keep context. Resume tomorrow with `/resume`.

### Research with the web

```bash
ra "Survey WebTransport support across browsers and CDNs. \
    Write a summary with a recommendation to research.md"
```

Fetches pages, reads specs, compares options, and writes a structured report you can share with your team.

### Slice a dataset

```bash
ra --file survey-results.csv "Find the three strongest correlations, \
    flag any obvious outliers, and write a one-page summary"
```

Reads the file, runs shell commands to slice the data, delivers findings in plain language.

### Generate release notes

```bash
ra "Write a v3.0 changelog from commits since the v2.9 tag. \
    Group by feature, fix, and breaking change."
```

Walks git history, categorizes commits, produces a polished changelog.

### Add AI to your product

```bash
ra --http --http-port 3000
```

POST a message, get SSE chunks back. No framework — just `Bun.serve()` under the hood.

### Specialize your editor

```bash
ra --mcp-stdio --config recipes/code-review-agent
```

Cursor or Claude Desktop now has a dedicated code reviewer using your project's style guide and skills.
