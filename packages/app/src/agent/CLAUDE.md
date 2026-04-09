# src/agent/

App-level agent utilities. The core `AgentLoop` lives in `@chinmaymk/ra` (`packages/ra/src/agent/`).

| File | Purpose |
|------|---------|
| `permissions.ts` | Compiles `permissions` config into a `beforeToolExecution` middleware that allows/denies tool calls by name and by field regex |
| `session.ts` | `createSessionMiddleware()` — composes per-session middleware (observability → user → history persistence) |
