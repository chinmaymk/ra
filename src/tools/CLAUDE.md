# src/tools/

14 built-in tools, each in its own file. `index.ts` registers them all.

## Files

| File | Tool Name | Category |
|------|-----------|----------|
| `read-file.ts` | `read_file` | Filesystem |
| `write-file.ts` | `write_file` | Filesystem |
| `update-file.ts` | `update_file` | Filesystem |
| `append-file.ts` | `append_file` | Filesystem |
| `list-directory.ts` | `list_directory` | Filesystem |
| `search-files.ts` | `search_files` | Filesystem |
| `glob-files.ts` | `glob_files` | Filesystem |
| `move-file.ts` | `move_file` | Filesystem |
| `copy-file.ts` | `copy_file` | Filesystem |
| `delete-file.ts` | `delete_file` | Filesystem |
| `execute-bash.ts` | `execute_bash` | Shell (Linux/macOS) |
| `execute-powershell.ts` | `execute_powershell` | Shell (Windows) |
| `web-fetch.ts` | `web_fetch` | Network |
| `ask-user.ts` | `ask_user` | Agent interaction |
| `checklist.ts` | `checklist` | Agent interaction |
| `subagent.ts` | `subagent` | Agent interaction (exported separately, not auto-registered) |

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
- All tools except `ask_user` are exposed when ra runs as MCP server
