---
name: add-tool
description: Use when adding a new built-in tool to ra.
---

# Adding a Built-in Tool

All 14 built-in tools follow the same factory function pattern. Use `read-file.ts` as a minimal template or `execute-bash.ts` for one with error handling.

## Files to Touch

1. **`src/tools/<name>.ts`** — Tool factory function
2. **`src/tools/index.ts`** — Import and register in `registerBuiltinTools()`
3. **`tests/tools/builtin-tools.test.ts`** — Add tests

## Tool Pattern

```ts
import type { ITool } from '../providers/types'

export function myNewTool(): ITool {
  return {
    name: 'my_tool',
    description: 'What this tool does. Be specific — the model reads this to decide when to use it.',
    inputSchema: {
      type: 'object',
      properties: {
        param: { type: 'string', description: 'What this param is for' },
        optional: { type: 'number', description: 'Optional with default' },
      },
      required: ['param'],
    },
    async execute(input: unknown) {
      const { param, optional = 42 } = input as { param: string; optional?: number }
      // Do the work
      return result  // string or JSON-serializable value
    },
  }
}
```

## Registration in `src/tools/index.ts`

```ts
import { myNewTool } from './my-tool'

export function registerBuiltinTools(registry: ToolRegistry): void {
  // ... existing tools
  registry.register(myNewTool())
}
```

## Key Points

- **Description matters.** The model decides whether to use the tool based on the description. Be clear about what it does, what it returns, and when to use it vs alternatives.
- **`inputSchema` is JSON Schema.** The model generates arguments based on this schema. Include `description` for every property.
- **Cast input narrowly.** `input as { param: string }` not `input as any`.
- **Return strings when possible.** The result gets serialized to string for the model. If you return an object, it gets `JSON.stringify()`'d.
- **Errors propagate.** If `execute()` throws, the error message becomes the tool result with `isError: true`. The model sees it and can retry or adjust.
- **Tool timeout.** Tools are subject to `toolTimeout` config (default 30s). Long-running tools should respect this.
- **MCP exposure.** When ra runs as MCP server, all built-in tools except `ask_user` are exposed. No extra work needed.

## Verification

1. `bun tsc` — no type errors
2. `bun test` — tests pass
3. Smoke test: `bun run ra "Use the my_tool tool to ..."` — verify the model calls it correctly
