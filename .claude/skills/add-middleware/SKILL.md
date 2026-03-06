---
name: add-middleware
description: Use when writing or debugging ra middleware hooks.
---

# Middleware

Middleware hooks intercept every step of the agent loop. Define them inline in config or as file paths.

## 9 Hooks

| Hook | Context Type | When |
|------|-------------|------|
| `beforeLoopBegin` | `LoopContext` | Once at start |
| `beforeModelCall` | `ModelCallContext` | Before each LLM call — can modify `request.messages` and `request.tools` |
| `onStreamChunk` | `StreamChunkContext` | Per streaming chunk |
| `afterModelResponse` | `ModelCallContext` | After model finishes |
| `beforeToolExecution` | `ToolExecutionContext` | Before each tool runs |
| `afterToolExecution` | `ToolResultContext` | After each tool returns |
| `afterLoopIteration` | `LoopContext` | After each loop iteration |
| `afterLoopComplete` | `LoopContext` | After final iteration |
| `onError` | `ErrorContext` | On exceptions |

## Context Shapes

Every context has `stop()` and `signal` (AbortSignal). Call `stop()` to halt the loop.

```ts
// LoopContext — available on all hooks via ctx.loop (or directly for loop-level hooks)
{ messages, iteration, maxIterations, sessionId, stop(), signal }

// ModelCallContext
{ request: { model, messages, tools?, thinking? }, loop: LoopContext }

// StreamChunkContext
{ chunk: StreamChunk, loop: LoopContext }

// ToolExecutionContext
{ toolCall: { id, name, arguments }, loop: LoopContext }

// ToolResultContext
{ toolCall: { id, name, arguments }, result: { toolCallId, content, isError? }, loop: LoopContext }

// ErrorContext
{ error: Error, phase: 'model_call' | 'tool_execution' | 'stream', loop: LoopContext }
```

## Config

```yaml
# ra.config.yml
middleware:
  beforeModelCall:
    - "(ctx) => { console.log('Calling model with', ctx.request.messages.length, 'messages') }"
  afterToolExecution:
    - "./middleware/log-tools.ts"
```

## File Middleware

Export a default async function:

```ts
// middleware/log-tools.ts
export default async (ctx) => {
  console.log(`Tool ${ctx.toolCall.name} returned:`, ctx.result.content.slice(0, 100))
}
```

## Common Patterns

**Token budget** — Stop the loop if usage exceeds a limit:
```ts
export default async (ctx) => {
  const lastDone = ctx.loop.messages.findLast(m => m.role === 'assistant')
  // Check accumulated usage and call ctx.stop() if over budget
}
```

**Tool filtering** — Remove tools from certain iterations:
```ts
// beforeModelCall
export default async (ctx) => {
  if (ctx.loop.iteration > 5) {
    ctx.request.tools = ctx.request.tools?.filter(t => t.name !== 'web_fetch')
  }
}
```

**Guardrails** — Block dangerous tool calls:
```ts
// beforeToolExecution
export default async (ctx) => {
  if (ctx.toolCall.name === 'execute_bash' && ctx.toolCall.arguments.includes('rm -rf')) {
    ctx.stop()
  }
}
```

## Key Points

- Middleware runs in array order. First middleware in the array runs first.
- `beforeModelCall` can mutate `ctx.request` — this is how you modify what the model sees.
- `stop()` is cooperative — the loop checks `signal.aborted` at each step.
- Context compaction is itself a `beforeModelCall` middleware, injected first.
- Middleware is subject to `toolTimeout` just like tools.
