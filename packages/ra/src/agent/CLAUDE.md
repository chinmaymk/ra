Core agent loop and infrastructure.

**Files:**
| File | Purpose |
|------|---------|
| `loop.ts` | `AgentLoop` — stream → collect tools → execute → repeat |
| `types.ts` | Middleware context types (`LoopContext`, `ModelCallContext`, etc.) |
| `middleware.ts` | `runMiddlewareChain()` / `mergeMiddleware()` |
| `tool-registry.ts` | `ToolRegistry` — register, lookup, execute tools |
| `context-compaction.ts` | Summarizes old messages when context grows. Injected as `beforeModelCall` middleware |
| `timeout.ts` | `withTimeout()` / `TimeoutError` |
| `token-estimator.ts` | `estimateTokens()` — chars/4 heuristic |
| `model-registry.ts` | `getContextWindowSize()` / `getDefaultCompactionModel()` / `setLearnedContextWindow()` |

**Loop terminates when:** no tool calls, `maxIterations` reached, `maxTokenBudget` exceeded, `maxDuration` exceeded, `stop()` called, or `signal.aborted`.

**Parallel tool calls:** when `parallelToolCalls` is true (default), multiple tool calls from a single model response execute concurrently via `Promise.all`. Set to false for sequential execution. Middleware (`beforeToolExecution`, `afterToolExecution`) still runs per tool call.

**Middleware:** runs in array order per hook. All contexts extend `StoppableContext` (`stop()` + `signal` + `logger`).
- `beforeModelCall` — can modify `ctx.request.messages` and `ctx.request.tools`
- `beforeToolExecution` — can `deny(reason)` to block without stopping the loop

**Compaction:** three zones (pinned, compactable, recent). Triggers at `threshold * contextWindow`. Won't split tool calls from results. Context window resolved as: config override → learned from errors → model registry → 200k fallback. On context length errors, `parseContextWindowFromError()` extracts the real limit and `setLearnedContextWindow()` caches it for future use.
