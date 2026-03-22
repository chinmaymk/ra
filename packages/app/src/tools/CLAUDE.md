# src/tools/

Built-in tools, each in its own file. `index.ts` registers them all.

## Files

| File | Tool Name | Category |
|------|-----------|----------|
| `read-file.ts` | `Read` | Filesystem |
| `write-file.ts` | `Write` | Filesystem |
| `update-file.ts` | `Edit` | Filesystem |
| `append-file.ts` | `AppendFile` | Filesystem |
| `list-directory.ts` | `LS` | Filesystem |
| `search-files.ts` | `Grep` | Filesystem |
| `glob-files.ts` | `Glob` | Filesystem |
| `move-file.ts` | `MoveFile` | Filesystem |
| `copy-file.ts` | `CopyFile` | Filesystem |
| `delete-file.ts` | `DeleteFile` | Filesystem |
| `shell-exec.ts` | `Bash` / `PowerShell` | Shell (platform-specific) |
| `web-fetch.ts` | `WebFetch` | Network |
| `subagent.ts` | `Agent` | Agent interaction (exported separately, not auto-registered) |

## Tool Pattern

Every tool file exports a factory function returning `ITool`:

```ts
export function myTool(): ITool {
  return { name, description, inputSchema, async execute(input) { ... } }
}
```

Registration in `index.ts`:
```ts
registry.register(myTool())
```

## Key Rules

- `description` drives model behavior — be specific about when to use the tool vs alternatives
- `inputSchema` is JSON Schema with `description` on every property
- Cast input narrowly: `input as { param: string }`, never `as any`
- Return strings when possible (objects get `JSON.stringify()`'d)
- Thrown errors become tool results with `isError: true`
- Tools are subject to `toolTimeout` (default 30s)
- All tools are exposed when ra runs as MCP server
