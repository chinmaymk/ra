# tests/

Test suite using Bun's built-in test runner. Mirrors the `src/` directory structure. Node.js compatibility tests in `tests/node/` use `node:test` + `node:assert`.

## Running Tests

```bash
bun test                    # all Bun tests
bun test tests/agent/       # tests in a directory
bun test tests/agent/loop   # tests matching a pattern
npx tsx --test tests/node/  # Node.js compatibility tests
```

## Test Patterns

### Provider Tests
Mock the SDK client and verify that ra's types map correctly:
```ts
import { test, expect, mock } from "bun:test"
// Mock the SDK, call provider.stream(), assert StreamChunk sequence
```

### Agent Loop Tests
Use `mockProvider()` that yields predetermined `StreamChunk[][]` sequences:
```ts
// Each inner array = one iteration's stream response
// Test tool execution, iteration counting, middleware integration
```

### Tool Tests
Call `tool.execute()` directly with known inputs, assert outputs:
```ts
const tool = myTool()
const result = await tool.execute({ param: "value" })
expect(result).toBe("expected")
```

### Integration Tests
Located in `tests/integration/`. Test full flows from config to output.

### Node.js Compatibility Tests
Located in `tests/node/`. Use `node:test` and `node:assert` so they run on both Bun and Node.js:
```ts
import { describe, it } from "node:test"
import assert from "node:assert/strict"
// Test that Node.js equivalents of Bun APIs work correctly
```

## Conventions

- Test file names: `<module>.test.ts`
- One `test()` per behavior, descriptive names
- Mock external dependencies, never make real API calls
- Bun tests: `import { test, expect } from "bun:test"`
- Node.js compat tests: `import { describe, it } from "node:test"` + `import assert from "node:assert/strict"`
