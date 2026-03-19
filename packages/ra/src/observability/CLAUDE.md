`logger.ts` — `Logger` interface + `NoopLogger`.

Always structured logging: `logger.info('event', { key: value })` — never interpolation.

`NoopLogger` is the default when no logger is provided. Concrete implementations live in `packages/app/`.
