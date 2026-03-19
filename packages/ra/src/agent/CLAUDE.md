Core agent loop and supporting infrastructure. This is the heart of ra.

**Files:**
| File | Purpose |
|------|---------|
| `loop.ts` | `AgentLoop` class — stream → collect tools → execute → repeat |
| `types.ts` | Middleware context types: `LoopContext`, `ModelCallContext`, `ToolExecutionContext`, etc. |
| `middleware.ts` | `runMiddlewareChain()` / `mergeMiddleware()` — executes middleware arrays in order |
| `tool-registry.ts` | `ToolRegistry` class — register, lookup, list, and execute tools by name |
| `context-compaction.ts` | Summarizes older messages when context grows too large. Injected as `beforeModelCall` middleware |
| `timeout.ts` | `withTimeout()` / `TimeoutError` — wraps tool and middleware execution with deadline |
| `token-estimator.ts` | `estimateTokens()` — chars/4 heuristic for messages, tools, and strings |
| `model-registry.ts` | `getContextWindowSize()` / `getDefaultCompactionModel()` — model family → context window lookup |

**AgentLoop Lifecycle:**
```
constructor(AgentLoopOptions) → run(messages) → LoopResult
```
Loop terminates when: no tool calls in response, `maxIterations` reached, `stop()` called, or `signal.aborted`.

**Middleware Chain:**
Middleware runs in array order per hook. Every hook context extends `StoppableContext` (`stop()` + `signal` + `logger`).

Mutable contexts:
- `beforeModelCall` — can modify `ctx.request.messages` and `ctx.request.tools`
- `beforeToolExecution` — can `deny(reason)` to block a tool call without stopping the loop

Compaction middleware is automatically prepended to `beforeModelCall` when `compaction.enabled` is true.

**Context Compaction:**
Three message zones: pinned (system + initial user), compactable (middle), recent (last few).
Triggers when token estimate exceeds `threshold * contextWindow`. Summarizes compactable zone using a cheap model. Respects tool-call boundaries — won't split a call from its result.

**Patterns:**
- All modules use `node:` prefixed imports only — no Bun/Deno APIs (runtime-agnostic)
- `withRetry()` wraps provider calls with exponential backoff for transient errors
- `randomUUID()` from `node:crypto` for session IDs
- Types are separate from implementation — `types.ts` has no logic
