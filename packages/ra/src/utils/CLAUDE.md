`errors.ts` — error handling and retry logic.

- `errorMessage(err)` — extracts message from unknown thrown value
- `ProviderError` — categorized error (`rate_limit`, `auth`, `network`, `server`, `overloaded`, `unknown`). `ProviderError.from(err)` classifies any error by status code. `retryable` getter controls retry behavior.
- `withRetry(fn, opts)` — exponential backoff for retryable errors. Default: 3 retries, 1s/2s/4s delays. Respects `AbortSignal`.
