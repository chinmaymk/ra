# src/agent/

The core agent loop and its supporting infrastructure.

## Files

| File | Purpose |
|------|---------|
| `loop.ts` | `AgentLoop` class — the heart of ra. Stream → collect tools → execute → repeat |
| `types.ts` | Context types for middleware: `LoopContext`, `ModelCallContext`, `ToolExecutionContext`, etc. |
| `middleware.ts` | `runMiddlewareChain()` — executes middleware arrays in order with timeout |
| `tool-registry.ts` | `ToolRegistry` class — registers, looks up, and lists tools |
| `context-compaction.ts` | Summarizes older messages when context grows. Injected as first `beforeModelCall` middleware |
| `timeout.ts` | `withTimeout()` utility for tool/middleware execution |

## AgentLoop (loop.ts)

Constructor takes `AgentLoopOptions`:
```ts
{ provider, tools, maxIterations?, model?, middleware?, sessionId?, thinking?, compaction?, toolTimeout? }
```

`run(messages)` returns `LoopResult { messages, iterations, usage }`.

The loop terminates when:
- Model response has no tool calls (natural completion)
- `maxIterations` reached
- `stop()` called from middleware
- `signal.aborted` is true

## Middleware Chain

Middleware runs in array order. Every hook receives a context extending `StoppableContext` (has `stop()` and `signal`).

Mutable contexts:
- `beforeModelCall` — can modify `ctx.request.messages` and `ctx.request.tools`
- `beforeToolExecution` — can inspect `ctx.toolCall` and call `stop()` to block

Compaction middleware is automatically prepended to `beforeModelCall` when `compaction.enabled` is true.

## Context Compaction (context-compaction.ts)

Three message zones: pinned (system + initial user message), compactable (middle), recent (last few).

Triggers when token estimate exceeds `threshold * contextWindow`. Summarizes compactable zone using a cheap model call. Respects tool-call boundaries (won't split a tool call from its result).
