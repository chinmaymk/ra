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

**TypeScript** — export a default async function:
```ts
export default async (ctx: ModelCallContext) => {
  // ctx.request, ctx.loop, ctx.stop(), ctx.signal
}
```

**Shell scripts** — use `.sh`/`.bash`/`.zsh` extension. Receives context via env vars, controls flow via exit code:
```yaml
middleware:
  beforeToolExecution:
    - "./hooks/check-tool.sh"   # shell script
    - "./middleware/log.ts"      # TS file
```
Exit 0 = allow, exit 2 = deny/stop, other = warn. Environment variables: `HOOK_EVENT`, `HOOK_SESSION`, `HOOK_ITERATION`, `HOOK_TOOL_NAME`, `HOOK_TOOL_INPUT`, etc.

See `src/agent/types.ts` for all context shapes. See the `add-middleware` skill for patterns and examples.
