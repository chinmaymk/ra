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
| `model-registry.ts` | `getContextWindowSize()` / `getDefaultCompactionModel()` |

**Loop terminates when:** no tool calls, `maxIterations` reached, `stop()` called, `maxDuration` exceeded, `tokenBudget` exceeded, or `signal.aborted`.

**stop() behavior:**
- `ctx.stop('reason')` — graceful: finishes current iteration, then exits
- `ctx.stop('reason', { immediate: true })` — hard kill: aborts mid-stream via AbortController
- `loop.abort()` — external hard kill (same as immediate stop)

**Long-running task options:** `parallelToolCalls`, `tokenBudget`, `maxDuration`, `onProgress`, `onCheckpoint`, `heartbeatTimeout`. Tools receive `ToolExecuteOptions` with `heartbeat()` and `signal`.

**Middleware:** runs in array order per hook. All contexts extend `StoppableContext` (`stop()` + `signal` + `logger`).
- `beforeModelCall` — can modify `ctx.request.messages` and `ctx.request.tools`
- `beforeToolExecution` — can `deny(reason)` to block without stopping the loop

**Tool execution internals:** `approveTool()` handles deny middleware, `finalizeToolResult()` handles afterToolExecution + checkpointing, `executeToolCall()` handles timeout/heartbeat/truncation. Both sequential and parallel paths share these helpers via `ToolExecEnv`.

**Compaction:** three zones (pinned, compactable, recent). Triggers at `threshold * contextWindow`. Won't split tool calls from results.
