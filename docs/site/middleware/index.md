# Middleware

Lifecycle hooks that let you intercept and modify the agent loop. Define them inline or as file paths.

```yaml
# ra.config.yml
middleware:
  beforeModelCall:
    - "(ctx) => { console.log('Calling model...'); }"
  afterToolExecution:
    - "./middleware/log-tools.ts"
```

Each middleware is an `async (ctx) => void` function. Every context object has `stop()` and `signal`:

```ts
ctx.stop()          // halt the agent loop
ctx.signal.aborted  // check if already stopped
```

## Hooks and context shapes

| Hook | Context | Description |
|------|---------|-------------|
| `beforeLoopBegin` | `LoopContext` | Once at loop start |
| `beforeModelCall` | `ModelCallContext` | Before each LLM call |
| `onStreamChunk` | `StreamChunkContext` | Per streaming chunk |
| `afterModelResponse` | `ModelCallContext` | After model finishes |
| `beforeToolExecution` | `ToolExecutionContext` | Before each tool call |
| `afterToolExecution` | `ToolResultContext` | After each tool returns |
| `afterLoopIteration` | `LoopContext` | After each loop iteration |
| `afterLoopComplete` | `LoopContext` | After the final iteration |
| `onError` | `ErrorContext` | On exceptions |

## Context types

### LoopContext

Available on all hooks via `ctx.loop` (or directly for loop-level hooks like `beforeLoopBegin`, `afterLoopIteration`, `afterLoopComplete`).

```ts
{
  messages: IMessage[]     // full conversation history
  iteration: number        // current loop iteration (0-indexed)
  maxIterations: number
  sessionId: string
  stop(): void
  signal: AbortSignal
}
```

### ModelCallContext

Used by `beforeModelCall` and `afterModelResponse`. You can inspect or modify the request before it's sent.

```ts
{
  request: {
    model: string
    messages: IMessage[]
    tools?: ITool[]
    thinking?: 'low' | 'medium' | 'high'
  }
  loop: LoopContext
}
```

### StreamChunkContext

Used by `onStreamChunk`. Fires for every chunk the model streams back.

```ts
{
  chunk:
    | { type: 'text'; delta: string }
    | { type: 'thinking'; delta: string }
    | { type: 'tool_call_start'; id: string; name: string }
    | { type: 'tool_call_delta'; id: string; argsDelta: string }
    | { type: 'tool_call_end'; id: string }
    | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } }
  loop: LoopContext
}
```

### ToolExecutionContext

Used by `beforeToolExecution`. Fires before each tool is invoked.

```ts
{
  toolCall: { id: string; name: string; arguments: string }
  loop: LoopContext
}
```

### ToolResultContext

Used by `afterToolExecution`. Fires after each tool returns.

```ts
{
  toolCall: { id: string; name: string; arguments: string }
  result: { toolCallId: string; content: string; isError?: boolean }
  loop: LoopContext
}
```

### ErrorContext

Used by `onError`. Fires when an exception occurs during the loop.

```ts
{
  error: Error
  phase: 'model_call' | 'tool_execution' | 'stream'
  loop: LoopContext
}
```

## Stopping the loop

Any middleware can call `ctx.stop()` to halt the agent loop early:

```ts
// middleware/guard.ts
export default async (ctx) => {
  if (ctx.loop.iteration > 10) {
    ctx.stop()
  }
}
```

## Inline middleware

Inline expressions are TypeScript strings in your config. They're transpiled at load time.

```yaml
middleware:
  beforeModelCall:
    - "(ctx) => { console.log('Messages:', ctx.request.messages.length); }"
  onError:
    - "(ctx) => { console.error(`[${ctx.phase}]`, ctx.error.message); }"
```

## File-based middleware

Export a default async function from a `.ts` or `.js` file:

```ts
// middleware/audit-log.ts
export default async (ctx) => {
  console.log(`Tool ${ctx.toolCall.name} returned:`, ctx.result.content)
}
```

Reference it by path in config:

```yaml
middleware:
  afterToolExecution:
    - "./middleware/audit-log.ts"
  beforeModelCall:
    - "./middleware/rate-limiter.ts"
```

Paths can be relative (to project root), absolute, or use `~` for home directory. Both `.ts` and `.js` files are supported — TypeScript is transpiled automatically by Bun.
