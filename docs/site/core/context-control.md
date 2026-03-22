# Context Control

ra gives you full control over what the model sees and when. Built-in mechanisms handle the common cases automatically — compaction, caching, thinking, context discovery — and [middleware hooks](/middleware/) let you intercept everything else.

## Smart context compaction

When conversations grow long, ra compacts automatically. It splits the history into three zones — pinned messages (system prompt, first user message), compactable middle, and recent turns — then summarizes the middle with a cheap model. You keep the context that matters.

```yaml
agent:
  compaction:
    enabled: true
    threshold: 0.8               # trigger at 80% of context window
    model: claude-haiku-4-5-20251001  # cheap model for summarization
```

Key properties:

- **Token-aware** — Uses real token counts from the provider when available, falls back to estimation.
- **Pinned zones** — System prompts and initial context never get compacted.
- **Tool-call-aware** — Boundaries never split an assistant message from its tool results.
- **Provider-portable** — Works the same across all providers. Default compaction models: Haiku for Anthropic, GPT-4o-mini for OpenAI, Gemini Flash for Google.

## Token tracking

ra tracks input and output tokens across every iteration of the loop. Your middleware can read cumulative usage via `ctx.loop.usage` and enforce budgets, log costs, or trigger compaction early.

```ts
// middleware/log-cost.ts
export default async (ctx) => {
  const { inputTokens, outputTokens } = ctx.loop.usage
  console.log(`Tokens used: ${inputTokens} in, ${outputTokens} out`)
}
```

## Prompt caching

For Anthropic, ra automatically applies cache hints to system prompts and tool definitions. This reduces costs on multi-turn sessions without any configuration — cached tokens are billed at a reduced rate.

## Extended thinking

Enable extended thinking for models that support it. Five modes control how the model reasons before responding.

| Mode | Behavior |
|------|----------|
| `off` | Disabled (default) |
| `low` | Minimal reasoning budget |
| `medium` | Moderate reasoning budget |
| `high` | Maximum reasoning budget |
| `adaptive` | `high` for the first 5 iterations, then `low` — balances deep initial reasoning with faster follow-up turns |

```bash
ra --thinking high "Design a database schema for a social network"
ra --thinking adaptive "Build a REST API"
```

```yaml
agent:
  thinking: adaptive
```

Optionally cap the thinking budget in tokens. The provider uses `min(levelBudget, cap)`:

```yaml
agent:
  thinking: high
  thinkingBudgetCap: 10000   # never exceed 10k thinking tokens
```

Thinking output streams to the terminal in the REPL, so you can watch the model reason in real time. In the [HTTP API](/api/), thinking tokens are emitted as `{"type":"thinking","delta":"..."}` SSE events.

## Context discovery

ra discovers and injects project context files into the conversation before your prompt. Configure which files to look for:

```yaml
agent:
  context:
    enabled: true
    patterns:
      - "CLAUDE.md"
      - "AGENTS.md"
      - "CONVENTIONS.md"
```

ra walks the directory tree upward to the git root, finds matching files, and injects them as system context. This is useful for project conventions, coding standards, or any persistent instructions.

## Pattern resolution

Reference files and URLs inline in your prompts — ra resolves them before the model sees the message.

```bash
ra "explain what @src/auth.ts does"            # file contents injected
ra "review @src/utils/*.ts for consistency"     # glob expansion
ra "summarize url:https://example.com/api-docs" # fetched page content
```

Two built-in resolvers are enabled by default:

| Resolver | Syntax | Description |
|----------|--------|-------------|
| File | `@path` or `@glob` | Resolves file contents, supports glob patterns |
| URL | `url:https://...` | Fetches and inlines page content |

Add custom resolvers for GitHub issues, database records, or anything else:

```yaml
agent:
  context:
    resolvers:
      - name: issues
        path: ./resolvers/github-issues.ts
```

## Middleware hooks

For full programmatic control over context, use [middleware](/middleware/). Every hook receives the full conversation history and can mutate it.

```yaml
agent:
  middleware:
    beforeModelCall:
      - "./middleware/enforce-budget.ts"
    afterToolExecution:
      - "./middleware/redact-secrets.ts"
```

```ts
// middleware/enforce-budget.ts — reject if context is too large
export default async (ctx) => {
  const totalChars = ctx.request.messages.reduce((n, m) => n + JSON.stringify(m).length, 0)
  if (totalChars > 500_000) ctx.stop()
}
```

## See also

- [Middleware](/middleware/) — all hook types and context shapes
- [Dynamic Prompts](/recipes/dynamic-prompts) — advanced middleware patterns for context injection
- [Configuration](/configuration/) — compaction and context settings
