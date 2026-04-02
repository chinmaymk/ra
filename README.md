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
  <a href="#observability">Observability</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#recipes">Recipes</a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="ra demo" width="800">
</p>

---

Agents run loops you can't see.

ra makes the loop explicit — and lets you control every step.

It runs tasks end-to-end like other agents, but unlike them, you can see, constrain, and reproduce everything it does. Not a framework. Not prompt chains. Just the loop, with control and visibility around it.

```bash
ra "Fix the failing tests and open a PR"
```

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

Intercept any step in the loop. Full context at every step — read it, mutate it, stop it.

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

## Observability

Every model call, tool execution, and decision is captured automatically.

`ra --inspector` shows the full run: iterations, tokens, tools, traces, message history.

```bash
ra --inspector        # web dashboard
ra --show-config      # resolved config as JSON
ra --show-context     # discovered context files
```

## Configuration

Config lives in your repo. No hidden prompts, no default system prompt. One engineer defines behavior — everyone else runs the same agent.

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

Complete agent configurations to fork and commit to your repo.

- **[Coding Agent](recipes/coding-agent/)** — file editing, shell, adaptive thinking, context compaction
- **[Code Review Agent](recipes/code-review-agent/)** — GitHub MCP, style guide, diff scripts, token budget middleware
- **[Auto-Research Agent](recipes/karpathy-autoresearch/)** — autonomous ML research: run experiments, evaluate, iterate
- **[Multi-Agent Orchestrator](recipes/multi-agent/)** — persistent specialist agents as independent processes

```bash
ra --config recipes/coding-agent/ra.config.yaml "Fix the failing test"
```

## More

[**Tools**](https://chinmaymk.github.io/ra/tools/) — filesystem, shell, web fetch, and a parallel sub-agent spawner. Each independently configurable or disabled.

[**Skills**](https://chinmaymk.github.io/ra/skills/) — reusable instruction bundles (`code-review`, `architect`, `debugger`, and more). Install from GitHub or npm.

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
