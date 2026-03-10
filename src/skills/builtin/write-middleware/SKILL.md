---
name: write-middleware
description: How to write ra middleware hooks for the agent loop lifecycle.
---

You are creating middleware for ra. Middleware hooks let you intercept and act on events in the agent loop — before model calls, after tool execution, on errors, and more. Follow this guide exactly.

## Available Hooks

| Hook | Context Type | Timing |
|------|-------------|--------|
| `beforeLoopBegin` | `LoopContext` | Once before the agent loop starts. Use for setup, logging, or injecting initial messages. |
| `beforeModelCall` | `ModelCallContext` | Before each LLM API call. Use for request modification, rate limiting, or logging. |
| `onStreamChunk` | `StreamChunkContext` | On each streaming chunk from the model. Use for real-time processing or progress tracking. |
| `afterModelResponse` | `ModelCallContext` | After the model finishes responding. Use for response validation or logging. |
| `beforeToolExecution` | `ToolExecutionContext` | Before a tool runs. Use for approval gates, argument validation, or audit logging. |
| `afterToolExecution` | `ToolResultContext` | After a tool completes. Use for result validation, transformation, or logging. |
| `afterLoopIteration` | `LoopContext` | After each complete loop iteration. Use for progress checks or early termination. |
| `afterLoopComplete` | `LoopContext` | Once after the loop finishes. Use for cleanup, final logging, or summary generation. |
| `onError` | `ErrorContext` | When an error occurs. Use for error reporting, recovery, or graceful degradation. |

## Context Types

Every context object includes `stop()` to halt the agent and `signal` (AbortSignal) to check cancellation.

```typescript
// Base fields available in all contexts
interface StoppableContext {
  stop: () => void      // call to halt the agent loop
  signal: AbortSignal   // check signal.aborted for cancellation
}

// LoopContext — used by beforeLoopBegin, afterLoopIteration, afterLoopComplete
interface LoopContext extends StoppableContext {
  messages: IMessage[]      // full message history
  iteration: number         // current iteration (0-based)
  maxIterations: number     // configured limit
  sessionId: string         // unique session identifier
  usage: TokenUsage         // cumulative token usage
  lastUsage: TokenUsage | undefined  // tokens from last model call
}

// ModelCallContext — used by beforeModelCall, afterModelResponse
interface ModelCallContext extends StoppableContext {
  request: ChatRequest      // the request being sent to the model
  loop: LoopContext         // access to loop state
}

// StreamChunkContext — used by onStreamChunk
interface StreamChunkContext extends StoppableContext {
  chunk: StreamChunk        // the current streaming chunk
  loop: LoopContext
}

// ToolExecutionContext — used by beforeToolExecution
interface ToolExecutionContext extends StoppableContext {
  toolCall: IToolCall       // tool name and arguments
  loop: LoopContext
}

// ToolResultContext — used by afterToolExecution
interface ToolResultContext extends StoppableContext {
  toolCall: IToolCall       // the tool that was called
  result: IToolResult       // the tool's return value
  loop: LoopContext
}

// ErrorContext — used by onError
interface ErrorContext extends StoppableContext {
  error: Error              // the error that occurred
  loop: LoopContext
  phase: 'model_call' | 'tool_execution' | 'stream'  // where the error happened
}
```

## File Format

Each middleware file exports a default async function that receives the hook's context:

```typescript
// middleware/log-calls.ts
import type { ModelCallContext } from 'ra/agent/types'

export default async function (ctx: ModelCallContext): Promise<void> {
  const messageCount = ctx.loop.messages.length
  console.log(`[middleware] Model call #${ctx.loop.iteration} with ${messageCount} messages`)
}
```

Another example — blocking dangerous tool calls:

```typescript
// middleware/guard-tools.ts
import type { ToolExecutionContext } from 'ra/agent/types'

export default async function (ctx: ToolExecutionContext): Promise<void> {
  const name = ctx.toolCall.name
  const blocked = ['rm', 'delete', 'drop']

  if (blocked.some(b => name.toLowerCase().includes(b))) {
    console.warn(`[guard] Blocked tool call: ${name}`)
    ctx.stop()
  }
}
```

## Config Format

Register middleware in `ra.config.yml` by mapping hook names to arrays of file paths:

```yaml
middleware:
  beforeModelCall:
    - ./middleware/log-calls.ts
  beforeToolExecution:
    - ./middleware/guard-tools.ts
  afterToolExecution:
    - ./middleware/validate-output.ts
  onError:
    - ./middleware/error-reporter.ts
```

You can also use inline expressions for simple one-liners:

```yaml
middleware:
  afterLoopIteration:
    - "async (ctx) => { if (ctx.iteration > 20) ctx.stop() }"
```

## Key Rules

- **Async functions.** Every middleware handler must be an async function (or return a Promise). The signature is `(ctx: ContextType) => Promise<void>`.
- **Typed context.** Import the context type from `ra/agent/types` for type safety. Each hook receives exactly the context type listed in the table above.
- **Sequential execution.** When multiple middleware are registered for the same hook, they run in order — first to last. If one calls `ctx.stop()`, the agent halts after the current hook completes.
- **Relative paths.** File paths in the config are resolved relative to the config file's directory. Use `./middleware/file.ts` not absolute paths.
- **No return value.** Middleware functions return `void`. They act through side effects: logging, modifying context fields, or calling `ctx.stop()`.
- **Error propagation.** If a middleware throws, the error propagates to the `onError` hook. Don't silently swallow errors.

## Common Patterns

### Rate Limiting

```typescript
let lastCall = 0
export default async function (ctx: ModelCallContext): Promise<void> {
  const elapsed = Date.now() - lastCall
  if (elapsed < 1000) {
    await new Promise(r => setTimeout(r, 1000 - elapsed))
  }
  lastCall = Date.now()
}
```

### Token Budget

```typescript
export default async function (ctx: LoopContext): Promise<void> {
  if (ctx.usage.totalTokens > 100_000) {
    console.warn('[budget] Token limit reached, stopping.')
    ctx.stop()
  }
}
```

### Audit Trail

```typescript
export default async function (ctx: ToolResultContext): Promise<void> {
  const entry = {
    timestamp: new Date().toISOString(),
    tool: ctx.toolCall.name,
    iteration: ctx.loop.iteration,
  }
  await Bun.file('./audit.jsonl').writer().write(JSON.stringify(entry) + '\n')
}
```
