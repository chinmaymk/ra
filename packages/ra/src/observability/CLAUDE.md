Structured logging interface. Defines the `Logger` contract used throughout the core library.

**Files:**
| File | Purpose |
|------|---------|
| `logger.ts` | `Logger` interface + `NoopLogger` class |

**Logger Interface:**
```ts
interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
  flush(): Promise<void>
}
```

**Patterns:**
- Always use structured logging: `logger.info('event name', { key: value })` — never string interpolation
- `NoopLogger` silently discards all messages — used as default when no logger is provided
- The core library only defines the interface. Concrete implementations (file-based, session-scoped) live in `packages/app/`
- `Logger` is passed via `AgentLoopOptions` and threaded through all middleware contexts via `StoppableContext`
