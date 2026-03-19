Tests for the `@chinmaymk/ra` core library. Uses Bun's built-in test runner.

**Running:**
```bash
bun test packages/ra/tests/           # all core tests
bun test packages/ra/tests/agent/     # agent tests only
bun test packages/ra/tests/providers/ # provider tests only
```

**Test Structure:**
```
agent/
  test-utils.ts              # mockProvider(), slowProvider(), makeModelCallCtx()
  loop.test.ts               # Core loop behavior
  loop-retry.test.ts         # Retry logic for transient errors
  loop-abort.test.ts         # Abort/cancellation
  loop-stop.test.ts          # Middleware stop() behavior
  context-compaction.test.ts # Compaction zone splitting and summarization
  tool-registry.test.ts      # Tool registration and execution
  token-estimator.test.ts    # Token estimation heuristic
  model-registry.test.ts     # Context window lookups
  timeout.test.ts            # withTimeout() behavior
providers/
  anthropic.test.ts          # Each provider gets its own test file
  openai-responses.test.ts
  openai-completions.test.ts
  google.test.ts
  ollama.test.ts
  bedrock.test.ts
  azure.test.ts
  registry.test.ts           # createProvider() factory
  utils.test.ts              # Shared provider utilities
```

**Key Test Helpers (`agent/test-utils.ts`):**
- `mockProvider(responses: StreamChunk[][])` — yields predetermined chunk sequences. Each inner array = one loop iteration
- `slowProvider(delayMs)` — delays mid-stream, for testing abort/timeout
- `makeModelCallCtx(messages)` — builds a `ModelCallContext` for compaction tests

**Patterns:**
- `import { test, expect } from "bun:test"` — never jest/vitest
- Provider tests mock the SDK client, verify ra's type mapping is correct
- Loop tests use `mockProvider()` with predetermined responses
- One `test()` per behavior, descriptive names
- Never make real API calls
