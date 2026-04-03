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
  <a href="#custom-tools">Custom Tools</a> &middot;
  <a href="#observability">Observability</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#recipes">Recipes</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="ra demo" width="800">
</p>

---

**Build your agent with ra.**

Most agents work great — until you need to change something. Swap the model, add a guardrail, write a custom tool, enforce a policy. That's where closed boxes break down.

ra is the infinitely customizable alternative. The model, the tools, the permissions, the guardrails, the system prompt, the middleware — every part is yours to configure, extend, or replace. Write custom tools in TypeScript or any scripting language. Intercept every step with middleware. And get full observability on every run — no extra setup.

A coding agent, a code reviewer, a research agent, a multi-agent orchestrator — these aren't separate codebases. They're different configs:

```bash
ra "Fix the failing tests and open a PR"
ra --config recipes/code-review-agent  "Review the last 3 PRs"
ra --config recipes/karpathy-autoresearch "Survey recent advances in KV-cache compression"
ra --config recipes/multi-agent "Refactor the auth module, test it, and update the docs"
```

One tool, any agent.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/chinmaymk/ra/main/install.sh | bash
```

Works with Anthropic, OpenAI, Google, Ollama, Bedrock, Azure, [OpenRouter](https://chinmaymk.github.io/ra/providers/openrouter), and [LiteLLM](https://chinmaymk.github.io/ra/providers/litellm) — switch with `--provider`.

## The Loop

Stream the model response, execute tool calls in parallel, repeat. Every step fires a middleware hook.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → stream response → [afterModelResponse]
  → [beforeToolExecution] → execute tools → [afterToolExecution]
  → [afterLoopIteration] → repeat or [afterLoopComplete]
```

The loop runs until the model stops calling tools or a guardrail fires — no arbitrary iteration caps. Token budgets and duration limits trigger a clean shutdown:

```yaml
agent:
  maxTokenBudget: 500_000
  maxDuration: 600_000
```

## Middleware

This is where ra becomes truly yours. Intercept any step in the loop — read the full context, mutate it, or stop it entirely.

```ts
// middleware/audit.ts — log every tool call
export default async (ctx) => {
  const { name, arguments: args } = ctx.toolCall
  ctx.logger.info('tool', { name, args })
}
```

```ts
// middleware/guard.ts — block destructive commands
export default async (ctx) => {
  if (ctx.toolCall.name === 'Bash' && ctx.toolCall.arguments.includes('--force')) {
    ctx.deny("Blocked: --force not allowed")
  }
}
```

Wire them to hooks in config:

```yaml
agent:
  middleware:
    afterToolExecution:
      - ./middleware/audit.ts
    beforeToolExecution:
      - ./middleware/guard.ts
```

Available hooks: `beforeLoopBegin`, `beforeModelCall`, `onStreamChunk`, `afterModelResponse`, `beforeToolExecution`, `afterToolExecution`, `afterLoopIteration`, `afterLoopComplete`, `onError`.

## Custom Tools

Need your agent to deploy, run a health check, or query an internal API? Write a tool in TypeScript:

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
    // your logic here
    return `Deployed ${branch} to staging`
  },
}
```

Or a shell script — any language works:

```bash
#!/bin/bash
# tools/health-check.sh
if [ "$1" = "--describe" ]; then
  echo '{ "name": "HealthCheck", "description": "Check service health", "parameters": { "url": { "type": "string" } } }'
  exit 0
fi
read -r input
curl -sf "$(echo "$input" | jq -r '.url')" && echo "healthy" || echo "down"
```

Register them in config:

```yaml
agent:
  tools:
    custom:
      - ./tools/deploy.ts
      - ./tools/health-check.sh
```

The model discovers them automatically. Your tools get the same observability and permission controls as built-in ones.

## Observability

Every agent you build with ra gets full observability for free — no extra code, no separate tracing library.

Every model call, tool execution, and decision is captured automatically. `ra --inspector` opens a web dashboard showing the full run: iterations, token spend, tool calls, traces, and the complete message history.

```bash
ra --inspector        # web dashboard
ra --show-config      # resolved config as JSON
ra --show-context     # discovered context files
```

## Configuration

Everything is configurable and nothing is hidden. Config lives in your repo — no hidden prompts, no default system prompt. One engineer defines the agent's behavior, commits it, and everyone on the team runs the exact same agent.

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

## Recipes

Each recipe is a complete agent — not a library, not a template, just a config file and optional middleware you commit to your repo.

| Recipe | What it does | Model | Key difference from vanilla ra |
|--------|-------------|-------|-------------------------------|
| **[Coding Agent](recipes/coding-agent/)** | Edits files, runs tests, ships code | Opus | Memory, high thinking, 200 iterations |
| **[Code Review Agent](recipes/code-review-agent/)** | Reviews PRs against your style guide | Sonnet | Token budget middleware, custom skills |
| **[Auto-Research Agent](recipes/karpathy-autoresearch/)** | Runs experiments, evaluates, iterates | Sonnet | 500 iterations, 15-min tool timeout |
| **[Multi-Agent Orchestrator](recipes/multi-agent/)** | Spawns and coordinates specialist agents | Sonnet | Concurrency 4, orchestrator skill |

Same binary. Same loop. Different behavior — defined entirely in config:

```bash
ra --config recipes/coding-agent "Fix the failing test"
```

## Extend It

ra is designed to be built on. Pick what you need:

[**Tools**](https://chinmaymk.github.io/ra/tools/) — filesystem, shell, web fetch, and a parallel sub-agent spawner. Enable, disable, or configure each one independently.

[**Skills**](https://chinmaymk.github.io/ra/skills/) — reusable instruction bundles (`code-review`, `architect`, `debugger`, and more). Install from GitHub or npm, or write your own.

[**MCP**](https://chinmaymk.github.io/ra/modes/mcp/) — expose skills as tools for Cursor, Claude Desktop, or other agents; connect to external MCP servers.

[**Memory**](https://chinmaymk.github.io/ra/tools/#memory) — SQLite-backed persistent memory with full-text search, scoped per project.

[**Cron**](https://chinmaymk.github.io/ra/modes/cron/) — run agent jobs on a schedule, each with isolated logs and traces.

[**GitHub Actions**](https://chinmaymk.github.io/ra/modes/github-actions/) — `uses: chinmaymk/ra@latest`, no install step.

Full reference in the [docs](https://chinmaymk.github.io/ra/).

## License

MIT

---

<p align="center">
  <b>ra</b> — Your agent, your rules.
</p>
