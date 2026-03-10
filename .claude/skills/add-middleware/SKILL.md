---
name: add-middleware
description: Use when writing or debugging ra middleware hooks.
---

# Writing Middleware

See `src/middleware/CLAUDE.md` for loading mechanics and `src/agent/types.ts` for all context shapes.

## The 9 Hooks

| Hook | Context | When | Can Mutate |
|------|---------|------|------------|
| `beforeLoopBegin` | `LoopContext` | Once at start | messages |
| `beforeModelCall` | `ModelCallContext` | Before each LLM call | request.messages, request.tools |
| `onStreamChunk` | `StreamChunkContext` | Per streaming chunk | — |
| `afterModelResponse` | `ModelCallContext` | After model finishes | — |
| `beforeToolExecution` | `ToolExecutionContext` | Before each tool runs | can `stop()` |
| `afterToolExecution` | `ToolResultContext` | After each tool returns | — |
| `afterLoopIteration` | `LoopContext` | After each iteration | — |
| `afterLoopComplete` | `LoopContext` | After final iteration | — |
| `onError` | `ErrorContext` | On exceptions | — |

Every context has `stop()` and `signal` (AbortSignal). Call `stop()` to halt the loop.

## File Middleware

Export a default async function:

```ts
// middleware/my-hook.ts
import type { ModelCallContext } from '../src/agent/types'

export default async (ctx: ModelCallContext) => {
  // ctx.request, ctx.loop, ctx.stop(), ctx.signal
}
```

## Config

```yaml
middleware:
  beforeModelCall:
    - "./middleware/my-hook.ts"           # file path
    - "(ctx) => { console.log('hey') }"  # inline expression
```

## Common Patterns

**Token budget** (afterModelResponse):
```ts
export default async (ctx) => {
  if (ctx.loop.usage.inputTokens > 100000) ctx.stop()
}
```

**Tool filtering** (beforeModelCall):
```ts
export default async (ctx) => {
  if (ctx.loop.iteration > 5)
    ctx.request.tools = ctx.request.tools?.filter(t => t.name !== 'web_fetch')
}
```

**Guardrail** (beforeToolExecution):
```ts
export default async (ctx) => {
  if (ctx.toolCall.name === 'execute_bash' && ctx.toolCall.arguments.includes('rm -rf'))
    ctx.stop()
}
```

## Rules

- Middleware runs in array order
- `beforeModelCall` can mutate `ctx.request` — this is how you modify what the model sees
- Context compaction is itself a `beforeModelCall` middleware, injected first automatically
- Middleware is subject to `toolTimeout` just like tools
