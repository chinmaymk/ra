# src/middleware/

Middleware loading from config. The actual middleware chain execution is in `src/agent/middleware.ts`.

## Files

| File | Purpose |
|------|---------|
| `loader.ts` | `loadMiddleware(config)` — resolves file paths, inline expressions, and shell entries into middleware functions |
| `shell.ts` | `createShellMiddleware()` — spawns a child process, pipes context JSON to stdin, reads mutations from stdout |

## How Middleware is Loaded

Config specifies middleware as arrays of strings per hook. Three entry types:
```yaml
middleware:
  beforeModelCall:
    - "./middleware/log.ts"                     # file path → imported, default export used
    - "(ctx) => { console.log(ctx) }"           # inline expression → transpiled and eval'd
    - "shell: ./middleware/check.sh"             # shell → spawned as child process
    - "shell: python3 ./middleware/guard.py"     # shell → arbitrary binary with args
```

Detection order in `loadOne()`: `shell:` prefix → `looksLikePath()` → inline expression.

`loadMiddleware()` returns a `Partial<MiddlewareConfig>` which is merged with empty defaults in `AgentLoop`.

## Shell Middleware Protocol

Shell middleware communicates via stdin/stdout/stderr:
- **stdin**: JSON `{ hook, loop, request?, toolCall?, result?, error?, phase? }`
- **stdout**: optional JSON `{ stop?, deny?, context? }` — mutations applied back to the context
- **stderr**: logged at debug level
- **exit code**: non-zero throws an error

See `shell.ts` for serialization/deserialization details.

## Writing Middleware Files

Export a default async function. The context type depends on which hook it's registered for:
```ts
export default async (ctx: ModelCallContext) => {
  // ctx.request, ctx.loop, ctx.stop(), ctx.signal
}
```

See `src/agent/types.ts` for all context shapes. See the `add-middleware` skill for patterns and examples.
