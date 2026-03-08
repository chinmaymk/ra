# The Agent Loop

ra runs a single, transparent loop: send messages to the model, stream the response, execute tool calls, repeat. Every step fires a middleware hook you can intercept.

```
┌─────────────────────────────────────────────────┐
│                  beforeLoopBegin                │
└──────────────────────┬──────────────────────────┘
                       ▼
         ┌─── beforeModelCall ◄────────────┐
         │                                 │
         ▼                                 │
    Stream response                        │
    (onStreamChunk)                        │
         │                                 │
         ▼                                 │
   afterModelResponse                      │
         │                                 │
         ├── No tool calls? ──► afterLoopComplete
         │
         ▼
   beforeToolExecution
         │
         ▼
    Execute tools
         │
         ├── ask_user? ──► suspend (loop exits without afterLoopComplete)
         │
         ▼
   afterToolExecution
         │
         ▼
   afterLoopIteration ────────────────────►┘
```

## How it works

1. **Start** — `beforeLoopBegin` fires once. Your middleware can set up logging, validate config, or inject initial context.

2. **Model call** — `beforeModelCall` fires with the full request (messages, tools, model). The model streams its response, firing `onStreamChunk` for every token. When done, `afterModelResponse` fires.

3. **Tool execution** — If the model called tools, `beforeToolExecution` fires for each one, then the tool runs, then `afterToolExecution` fires with the result.

4. **Iterate or complete** — If tools were called, `afterLoopIteration` fires and the loop goes back to step 2. If no tools were called, `afterLoopComplete` fires and the loop ends.

5. **Suspend** — The `ask_user` tool is special: it suspends the loop and returns control to the caller. The session is saved so you can resume later.

## Loop controls

The loop tracks token usage per iteration, enforces `maxIterations`, and supports an `AbortController`. Any middleware can call `ctx.stop()` to halt the loop cleanly.

```yaml
maxIterations: 50   # default — prevents runaway loops
toolTimeout: 30000  # per-tool timeout in ms
```

```ts
// middleware/budget.ts — stop if we've used too many tokens
export default async (ctx) => {
  if (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens > 100_000) {
    ctx.stop()
  }
}
```

See [Middleware](/middleware/) for all available hooks and their context shapes.
