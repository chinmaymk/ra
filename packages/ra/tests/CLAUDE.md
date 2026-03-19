Core library tests. `import { test, expect } from "bun:test"` — never jest/vitest.

**Helpers (`agent/test-utils.ts`):**
- `mockProvider(responses: StreamChunk[][])` — each inner array = one loop iteration
- `slowProvider(delayMs)` — delays mid-stream for abort/timeout tests
- `makeModelCallCtx(messages)` — builds `ModelCallContext` for compaction tests

**Patterns:**
- Provider tests: mock SDK client, verify type mapping
- Loop tests: use `mockProvider()` with predetermined responses
- Never make real API calls
