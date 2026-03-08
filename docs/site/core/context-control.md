# Context Control

ra gives you full control over what the model sees and when. Middleware hooks let you intercept every step, but ra also has built-in mechanisms for managing context automatically.

## Smart context compaction

When conversations grow, ra compacts automatically. It splits the history into three zones — pinned messages (system prompt, first user message), compactable middle, and recent turns — then summarizes the middle with a cheap model. You keep the context that matters.

```yaml
compaction:
  enabled: true
  threshold: 0.8               # trigger at 80% of context window
  model: claude-haiku-4-5-20251001  # cheap model for summarization
```

- **Token-aware** — Uses real token counts from the provider when available, falls back to estimation.
- **Pinned zones** — System prompts and initial context never get compacted.
- **Tool-call-aware** — Boundaries never split an assistant message from its tool results.
- **Provider-portable** — Works the same across all providers. Default compaction models per provider (Haiku for Anthropic, GPT-4o-mini for OpenAI, Gemini Flash for Google).

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

Automatic cache hints on system prompts and tool definitions for Anthropic, reducing costs on multi-turn sessions without any config.

## Extended thinking

Enable extended thinking for models that support it. Three budget levels control how much the model reasons before responding.

```bash
ra --thinking high "Design a database schema for a social network"
```

```yaml
thinking: high  # low | medium | high (token budgets vary by provider)
```

Thinking output streams to the terminal in the REPL, so you can watch the model reason in real time.

## Context discovery

ra can discover and inject project context files into the conversation before your prompt. Configure which files to look for via the `context.patterns` config:

```yaml
context:
  enabled: true
  patterns:
    - "CLAUDE.md"
    - "AGENTS.md"
    - "CONVENTIONS.md"
```

ra walks the directory tree upward to the git root, finds matching files, and injects them as context.

## Pattern resolution

Reference files and URLs inline in your prompts — ra resolves them before the model sees the message.

```bash
ra "explain what @src/auth.ts does"            # file contents injected
ra "review @src/utils/*.ts for consistency"     # glob expansion
ra "summarize url:https://example.com/api-docs" # fetched page content
```

Two built-in resolvers (`@` for files/globs, `url:` for URLs) are enabled by default. Add custom resolvers for GitHub issues, database records, or anything else:

```yaml
context:
  resolvers:
    - name: issues
      path: ./resolvers/github-issues.ts
```

## Middleware hooks

For full programmatic control over context, use middleware. Every hook receives the full conversation history and can mutate it.

```yaml
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

See [Middleware](/middleware/) for all hook types and context shapes.
