# Middleware Config File Support

**Date:** 2026-03-03
**Status:** Approved

## Overview

Allow users to define agent loop middleware directly in `ra.config.yml` (or `.json`/`.toml`) as either file paths or inline JS expressions. Middleware is invoked at named lifecycle hooks in the agent loop.

## Config Format

```yaml
middleware:
  beforeModelCall:
    - ./log-requests.js
    - "async (ctx) => { console.log(ctx.request.model) }"
  onStreamChunk:
    - "async (ctx) => { process.stdout.write(ctx.chunk.delta ?? '') }"
  onError:
    - ./error-reporter.js
```

File-based middleware exports a default function:

```js
// log-requests.js
export default async function(ctx) {
  console.log('model:', ctx.request.model)
}
```

## Detection Heuristic

A string is a **file path** if it starts with `.`, `/`, or `~`, OR ends with `.js`/`.ts`. Everything else is an **inline expression**.

## Middleware Signature

```ts
type Middleware<T> = (ctx: T) => Promise<void>
```

No `next` argument. The chain runs all handlers sequentially. Middleware can stop the chain and the loop by calling `ctx.stop()`.

## Loop Interruption via AbortSignal

Each agent loop run creates a single `AbortController`. The signal is shared across all context objects for that run. Calling `ctx.stop()` calls `controller.abort()`.

`runMiddlewareChain` checks the signal before each handler:

```ts
for (const mw of chain) {
  if (signal.aborted) break
  await mw(ctx)
}
```

The agent loop checks `signal.aborted` after each `runMiddlewareChain` call and breaks if set:

```ts
await runMiddlewareChain(ctx, signal, chain)
if (signal.aborted) break
```

Example middleware using stop:

```js
async (ctx) => {
  if (ctx.messages.length > 50) ctx.stop()
}
```

## Context Types

All context objects expose `stop()` (bound to the shared `AbortController`) and `signal` (the `AbortSignal`):

| Hook | Context type | Key fields |
|------|-------------|------------|
| `beforeLoopBegin` | `LoopContext` | `messages`, `iteration`, `maxIterations`, `sessionId` |
| `beforeModelCall` | `ModelCallContext` | `request`, `loop` |
| `onStreamChunk` | `StreamChunkContext` | `chunk`, `loop` |
| `beforeToolExecution` | `ToolExecutionContext` | `toolCall`, `loop` |
| `afterToolExecution` | `ToolResultContext` | `toolCall`, `result`, `loop` |
| `afterModelResponse` | `ModelCallContext` | `request`, `loop` |
| `afterLoopIteration` | `LoopContext` | `messages`, `iteration`, `maxIterations`, `sessionId` |
| `afterLoopComplete` | `LoopContext` | `messages`, `iteration`, `maxIterations`, `sessionId` |
| `onError` | `ErrorContext` | `error`, `loop`, `phase` |

## Loader (`src/middleware/loader.ts`)

`loadMiddleware(config: RaConfig, cwd: string): Promise<Partial<MiddlewareConfig>>`

- Iterates over `config.middleware` entries
- For each string: detects path vs inline
  - **File**: resolves relative to `cwd`, dynamic `import(path)`, uses `.default`
  - **Inline**: wraps in `(0, eval)('(' + expr + ')')` to get the function
- Warns and skips unknown hook names
- Throws with clear message on load/parse failure
- Returns `Partial<MiddlewareConfig>` to merge into `AgentLoop` options

## Wiring (`src/index.ts`)

After `loadConfig`, call `loadMiddleware(config, process.cwd())` and pass the result as `middleware` to every `AgentLoop` construction (CLI, REPL, HTTP, MCP interfaces).

## Changes Required

| File | Change |
|------|--------|
| `src/agent/types.ts` | Add `stop()` and `signal` to all context types; change `Middleware<T>` to `(ctx: T) => Promise<void>` |
| `src/agent/middleware.ts` | Accept `AbortSignal`, check before each handler |
| `src/agent/loop.ts` | Create `AbortController` per run; pass signal through; check `signal.aborted` after chains; wire `stop()` into contexts |
| `src/middleware/loader.ts` | New file: loads file/inline middleware from config |
| `src/index.ts` | Call `loadMiddleware` and pass to all `AgentLoop` instances |

## No Config Type Changes

`RaConfig.middleware` is already `Record<string, string[]>`. No schema changes needed.
