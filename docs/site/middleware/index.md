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

## Hooks

| Hook | When |
|------|------|
| `beforeLoopBegin` | Once at loop start |
| `beforeModelCall` | Before each LLM call |
| `onStreamChunk` | Per streaming chunk |
| `afterModelResponse` | After model finishes |
| `beforeToolExecution` | Before each tool call |
| `afterToolExecution` | After each tool returns |
| `afterLoopIteration` | After each loop iteration |
| `afterLoopComplete` | After the final iteration |
| `onError` | On exceptions |

## Stopping the loop

Any middleware can call `ctx.stop()` to halt the agent loop early:

```ts
// middleware/guard.ts
export default (ctx) => {
  if (ctx.iteration > 10) {
    ctx.stop()
  }
}
```

## Inline middleware

```yaml
middleware:
  beforeModelCall:
    - "(ctx) => { console.log('Messages:', ctx.messages.length); }"
  onError:
    - "(ctx) => { console.error('Error:', ctx.error); }"
```

## File-based middleware

```yaml
middleware:
  afterToolExecution:
    - "./middleware/audit-log.ts"
  beforeModelCall:
    - "./middleware/rate-limiter.ts"
```
