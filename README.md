<h1 align="center">ra</h1>

<p align="center"><strong>Your agent, your rules.</strong></p>

<p align="center">
  <a href="https://github.com/chinmaymk/ra/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://github.com/chinmaymk/ra/actions"><img src="https://img.shields.io/github/actions/workflow/status/chinmaymk/ra/ci.yml?branch=main" alt="Build"></a>
  <a href="https://github.com/chinmaymk/ra/releases"><img src="https://img.shields.io/github/v/release/chinmaymk/ra?include_prereleases" alt="Release"></a>
</p>

<p align="center">
  <a href="#install">Install</a> &middot;
  <a href="#the-loop">The Loop</a> &middot;
  <a href="#middleware">Middleware</a> &middot;
  <a href="#tools">Tools</a> &middot;
  <a href="#skills">Skills</a> &middot;
  <a href="#recipes">Recipes</a> &middot;
  <a href="#docs">Docs</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="ra demo" width="800">
</p>

---

Most agents work great — until you need to change something. ra gives you the same power with full control. Every part is yours to configure, extend, or replace.

A coding agent, a code reviewer, a research agent, a multi-agent orchestrator — these aren't separate codebases. They're different configs:

```bash
ra "Fix the failing tests and open a PR"
ra --config recipes/code-review-agent  "Review the last 3 PRs"
ra --config recipes/karpathy-autoresearch "Survey recent advances in KV-cache compression"
ra --config recipes/multi-agent "Refactor the auth module, test it, and update the docs"
```

Same binary. Any agent. Defined entirely in config.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
```

Works with **Anthropic**, **OpenAI**, **Google**, **Ollama**, **Bedrock**, **Azure**, [**OpenRouter**](https://chinmaymk.github.io/ra/providers/openrouter), and [**LiteLLM**](https://chinmaymk.github.io/ra/providers/litellm) — switch with `--provider`.

## The Loop

Stream the model response, execute tool calls in parallel, repeat. Every step fires a middleware hook.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → stream response → [afterModelResponse]
  → [beforeToolExecution] → execute tools → [afterToolExecution]
  → [afterLoopIteration] → repeat or [afterLoopComplete]
```

No arbitrary iteration caps. The loop runs until the model stops calling tools or a guardrail fires. Token budgets and duration limits trigger a clean shutdown:

```yaml
agent:
  maxTokenBudget: 500_000
  maxDuration: 600_000
```

**Adaptive thinking** scales reasoning effort — high early for planning, low later for execution. Context compaction kicks in automatically when approaching the window limit — no dropped conversations, no silent truncation.

## Middleware

Intercept any step in the loop — read the full context, mutate it, or stop it entirely.

```ts
// middleware/guard.ts — block destructive commands
export default async (ctx) => {
  if (ctx.toolCall.name === 'Bash' && ctx.toolCall.arguments.includes('--force')) {
    ctx.deny("Blocked: --force not allowed")
  }
}
```

```ts
// middleware/audit.ts — log every tool call
export default async (ctx) => {
  const { name, arguments: args } = ctx.toolCall
  ctx.logger.info('tool', { name, args })
}
```

Wire them to hooks in config:

```yaml
agent:
  middleware:
    beforeToolExecution:
      - ./middleware/guard.ts
    afterToolExecution:
      - ./middleware/audit.ts
```

**Available hooks:** `beforeLoopBegin`, `beforeModelCall`, `onStreamChunk`, `afterModelResponse`, `beforeToolExecution`, `afterToolExecution`, `afterLoopIteration`, `afterLoopComplete`, `onError`.

## Tools

**Built-in:** `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `Agent` (parallel sub-agents), and more — enable, disable, or configure each one independently.

**Custom tools** — deploy, query an internal API, run a health check — export a function and register it:

```ts
// tools/deploy.ts
export default {
  name: 'Deploy',
  description: 'Deploy a branch to staging',
  parameters: {
    branch: { type: 'string', description: 'Git branch to deploy' },
    dryRun: { type: 'boolean', description: 'Preview only', optional: true },
  },
  async execute(input) {
    const { branch, dryRun } = input as { branch: string; dryRun?: boolean }
    return `Deployed ${branch} to staging`
  },
}
```

```yaml
agent:
  tools:
    custom:
      - ./tools/deploy.ts
```

Works with shell scripts and any scripting language too — [see the docs](https://chinmaymk.github.io/ra/tools/custom).

## Skills

Reusable instruction bundles that shape agent behavior. `/code-review`, `/architect`, `/debugger`, `/deep-research` — install from GitHub or npm, or write your own.

```yaml
agent:
  skillDirs: [./skills]
```

Each skill is a Markdown file with optional scripts and reference docs. The agent picks them up automatically — no code changes needed.

## Recipes

Each recipe is a complete agent — a config file and optional middleware you commit to your repo.

| Recipe | What it does | Model | Key difference |
|--------|-------------|-------|----------------|
| **[Coding Agent](recipes/coding-agent/)** | Edits files, runs tests, ships code | Opus | Memory, high thinking, read-before-write discipline |
| **[Code Review Agent](recipes/code-review-agent/)** | Reviews PRs against your style guide | Sonnet | Token budget middleware, severity tiers |
| **[Auto-Research](recipes/karpathy-autoresearch/)** | Runs experiments, evaluates, iterates | Sonnet | 500 iterations, 15-min tool timeouts |
| **[Multi-Agent](recipes/multi-agent/)** | Spawns and coordinates specialist agents | Sonnet | Concurrency 4, orchestrator skill |
| **[oh-my-ra](recipes/oh-my-ra/)** | Batteries-included: coding + research + debugging + delivery | Sonnet | 16 skills, 8 middleware, 2 custom tools |
| **[Auto-Improve](recipes/auto-improve/)** | Hyperparameter and prompt optimization | Sonnet | Parallel axis exploration, checkpoint recovery |
| **[ra-claude-code](recipes/ra-claude-code/)** | Coding agent inspired by Claude Code | Opus | 10 on-demand skills, session memory |

```bash
ra --config recipes/oh-my-ra "Refactor the auth module and write tests"
```

## Configuration

Config lives in your repo — no hidden prompts, no default system prompt. One engineer defines the agent, commits it, everyone runs the exact same thing.

```yaml
# ra.config.yml
agent:
  provider: anthropic
  model: claude-sonnet-4-6
  thinking: adaptive
  maxTokenBudget: 500_000
  skillDirs: [./skills]
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard", "--no-verify"]
      - tool: Write
        path:
          deny: ["\\.env"]
  middleware:
    - ./middleware/token-budget.ts
    - ./middleware/audit-log.ts
  memory:
    enabled: true
```

Layered overrides: `defaults → config file → env vars → CLI flags`. YAML, JSON, or TOML.

## Run Anywhere

ra isn't just a CLI. Pick the interface that fits your workflow:

| Mode | Command | Use case |
|------|---------|----------|
| **REPL** | `ra` | Interactive multi-turn with history, slash commands, file attachments |
| **CLI** | `ra "prompt"` | One-shot prompts, piping, scripting |
| **HTTP** | `ra --http` | Streaming chat API with session management |
| **MCP** | `ra --mcp-stdio` | Expose as a tool for Cursor, Claude Desktop, or other agents |
| **Cron** | `ra --interface cron` | Scheduled autonomous jobs with isolated logs |
| **Inspector** | `ra --inspector` | Web dashboard — iterations, tokens, tool calls, traces |

## Observability

Every model call, tool execution, and decision is captured automatically. Structured JSONL logs, trace spans, and a built-in web inspector.

```bash
ra --inspector        # web dashboard
ra --show-config      # resolved config as JSON
ra --show-context     # discovered context files
```

## Docs

Full reference at [chinmaymk.github.io/ra](https://chinmaymk.github.io/ra/) — tools, skills, middleware, providers, configuration, and deployment guides.

## License

MIT

---

<p align="center">
  <b>ra</b> — Your agent, your rules.
</p>
