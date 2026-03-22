---
name: add-tool
description: Use when adding a new built-in tool to ra.
---

# Adding a Built-in Tool

See `src/tools/CLAUDE.md` for the full file map. Use `read-file.ts` as a minimal template.

## Checklist

1. **Create `src/tools/<name>.ts`**

```ts
import type { ITool } from '../providers/types'

export function myNewTool(): ITool {
  return {
    name: 'my_tool',
    description: 'What this tool does. Be specific — the model reads this.',
    inputSchema: {
      type: 'object',
      properties: {
        param: { type: 'string', description: 'What this param is for' },
      },
      required: ['param'],
    },
    async execute(input: unknown) {
      const { param } = input as { param: string }
      return result  // string preferred; objects get JSON.stringify()'d
    },
  }
}
```

2. **Register in `src/tools/index.ts`**

```ts
import { myNewTool } from './my-tool'
// Inside registerBuiltinTools():
registry.register(myNewTool())
```

3. **Add tests in `tests/tools/`**

```ts
import { test, expect } from 'bun:test'
import { myNewTool } from '../../src/tools/my-tool'

test('my_tool does the thing', async () => {
  const tool = myNewTool()
  const result = await tool.execute({ param: 'value' })
  expect(result).toBe('expected')
})
```

4. **Verify**: `bun tsc` → `bun test` → `bun run ra "Use the my_tool tool to ..."`

## Rules

- `description` drives model behavior — be specific about when to use vs alternatives
- `inputSchema` is JSON Schema — include `description` on every property
- Cast input narrowly: `input as { param: string }`, never `as any`
- Thrown errors become tool results with `isError: true` — the model sees them
- Tools are subject to `toolTimeout` (default 30s)
- All built-in tools are auto-exposed when ra runs as MCP server
