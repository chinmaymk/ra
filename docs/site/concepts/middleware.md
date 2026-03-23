# Middleware

Middleware lets you hook into the [agent loop](/concepts/agent-loop) at every stage. You can observe what's happening, modify data in flight, or stop the loop entirely — without changing any core code.

## The idea

The agent loop fires events at predictable points: before calling the model, after receiving a response, before running a tool, and so on. Middleware functions listen to these events and act on them.

This is how ra stays simple at the core while supporting complex behaviors like audit logging, budget limits, permission checks, and custom tool orchestration.

## The nine hooks

```
beforeLoopBegin
│
├─→ beforeModelCall ──→ onStreamChunk* ──→ afterModelResponse
│
├─→ beforeToolExecution ──→ afterToolExecution
│
├─→ afterLoopIteration
│
└─→ afterLoopComplete

onError (fires on any exception)
```

Each hook receives a context object with the current state — messages, token usage, iteration count — plus methods to control the loop.

## A simple example

A middleware that stops the loop after spending too many tokens:

```typescript
// middleware/budget.ts
export default function budgetGuard(maxTokens: number) {
  return {
    afterModelResponse(ctx) {
      if (ctx.totalTokens > maxTokens) {
        ctx.stop(`Budget exceeded: ${ctx.totalTokens} tokens used`)
      }
    }
  }
}
```

## Registering middleware

Point your config at middleware files:

```yaml
agent:
  middleware:
    - ./middleware/budget.ts
    - ./middleware/audit-log.ts
```

ra loads each file, calls its default export, and wires the hooks into the loop. Middleware runs in the order listed.

## What you can do

| Capability | How |
|-----------|-----|
| **Observe** | Log events, track metrics, record traces |
| **Modify** | Change messages or tools in `beforeModelCall` |
| **Block** | Call `deny()` in `beforeToolExecution` to prevent a tool from running |
| **Stop** | Call `stop()` from any hook to end the loop |

Every hook has access to a structured `logger` for observability.

## Inline middleware

For quick experiments, you can write middleware as inline expressions in your config:

```yaml
agent:
  middleware:
    - "(ctx) => { ctx.logger.info('model called', { model: ctx.model }) }"
```

This is useful for one-liners but file-based middleware is better for anything non-trivial.

See [Middleware reference](/middleware/) for the full hook API and context types.
