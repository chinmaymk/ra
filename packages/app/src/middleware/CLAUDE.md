# src/middleware/

Middleware loading from config. The actual middleware chain execution is in `src/agent/middleware.ts`.

## Files

| File | Purpose |
|------|---------|
| `loader.ts` | `loadMiddleware(config)` — resolves file paths and inline expressions into middleware functions |

## How Middleware is Loaded

Config specifies middleware as arrays of strings per hook:
```yaml
middleware:
  beforeModelCall:
    - "./middleware/log.ts"           # file path → imported, default export used
    - "(ctx) => { console.log(ctx) }" # inline expression → wrapped in AsyncFunction
```

`loadMiddleware()` returns a `Partial<MiddlewareConfig>` which is merged with empty defaults in `AgentLoop`.

## Writing Middleware Files

Export a default async function. The context type depends on which hook it's registered for:
```ts
export default async (ctx: ModelCallContext) => {
  // ctx.request, ctx.loop, ctx.stop(), ctx.signal
}
```

See `src/agent/types.ts` for all context shapes. See the `add-middleware` skill for patterns and examples.
