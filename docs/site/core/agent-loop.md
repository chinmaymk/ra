# The Agent Loop

ra's core loop is simple: send messages to the model, stream the response, execute any tool calls, repeat. Every step fires a [middleware hook](/middleware/) you can intercept. The loop handles iteration, token tracking, and tool execution — you control everything else through system prompts, skills, and middleware.

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
         ▼
   afterToolExecution
         │
         ▼
   afterLoopIteration ────────────────────►┘
```

## How it works

1. **Start** — `beforeLoopBegin` fires once. Your middleware can set up logging, validate config, or inject initial context.

2. **Model call** — `beforeModelCall` fires with the full request (messages, tools, model). The model streams its response, firing `onStreamChunk` for every token. When the response is complete, `afterModelResponse` fires.

3. **Tool execution** — If the model requested tool calls, `beforeToolExecution` fires for each one, then the tool runs, then `afterToolExecution` fires with the result.

4. **Iterate or complete** — If tools were called, `afterLoopIteration` fires and the loop goes back to step 2 with the tool results appended to the conversation. If no tools were called, `afterLoopComplete` fires and the loop ends.

## Loop controls

The loop tracks token usage per iteration, enforces `maxIterations`, and supports an `AbortController`. Any middleware can call `ctx.stop()` to halt the loop cleanly.

```yaml
agent:
  maxIterations: 0      # default 0 = unlimited
  toolTimeout: 120000  # per-tool timeout in ms (default: 2 minutes)
```

```ts
// middleware/budget.ts — stop if we've used too many tokens
export default async (ctx) => {
  if (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens > 100_000) {
    ctx.stop()
  }
}
```

## See also

- [Middleware](/middleware/) — all available hooks and their context shapes
- [Built-in Tools](/tools/) — tools available to the agent
- [Context Control](/core/context-control) — how ra manages what the model sees
- [Configuration](/configuration/) — `maxIterations` and `toolTimeout` settings
