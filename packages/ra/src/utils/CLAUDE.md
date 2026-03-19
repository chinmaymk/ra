Shared utilities for the core library.

**Files:**
| File | Purpose |
|------|---------|
| `errors.ts` | `errorMessage()`, `ProviderError` class, `withRetry()` |

**ProviderError:**
Categorized error class for provider API failures. Categories: `rate_limit`, `auth`, `network`, `server`, `overloaded`, `unknown`.
- `ProviderError.from(err)` classifies any thrown value by inspecting status codes and error messages
- `retryable` getter returns `true` for rate_limit, server, overloaded, network errors
- Extracts `retry-after` headers when available

**withRetry():**
Generic async retry with exponential backoff. Retries only `ProviderError.retryable` errors. Supports abort signals and custom `onRetry` callbacks. Default: 3 retries with 1s/2s/4s delays.

**Patterns:**
- Runtime-agnostic — uses only standard ECMAScript and `node:` APIs
- No Bun/Deno-specific code
- Custom `sleep()` implementation respects `AbortSignal` for clean cancellation
