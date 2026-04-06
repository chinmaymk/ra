# src/tools/

Built-in tools, each in its own file. `index.ts` registers them all.

`loader.ts` handles file-based custom tools (`agent.tools.custom` in config). Supports `parameters` shorthand (auto-converted to JSON Schema), factory functions, and shell scripts.

`shell-tool.ts` wraps shell scripts (`.sh`, `.py`, etc.) as tools. Scripts self-describe via `--describe` flag and receive tool input as JSON on stdin.

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
| `ensure-dir.ts` | `EnsureDir` | Filesystem |
| `root-dir.ts` | — | Helper: resolves the workspace root |
| `shell-exec.ts` | `Bash` / `PowerShell` | Shell (platform-specific) |
| `web-fetch.ts` | `WebFetch` | Network |
| `subagent.ts` | `Agent` | Agent interaction (exported separately, not auto-registered) |
| `shell-tool.ts` | (dynamic) | Shell script tools — loaded from `agent.tools.custom` |

## Shell Script Tools

Shell scripts listed in `agent.tools.custom` are auto-detected by extension (same extensions as middleware: `.sh`, `.py`, `.rb`, etc.) or via `shell:` prefix. Scripts must support `--describe` to output their tool definition:

```bash
#!/bin/bash
if [ "$1" = "--describe" ]; then
  cat << 'EOF'
  { "name": "MyTool", "description": "Does something",
    "parameters": { "query": { "type": "string", "description": "Search query" } } }
  EOF
  exit 0
fi
read -r input
echo "result: $(echo "$input" | jq -r '.query')"
```

**Protocol:**
- `--describe` → stdout JSON `{ name, description, inputSchema | parameters, timeout? }`
- Execute: stdin = JSON tool input, stdout = tool result, stderr = logged, non-zero exit = error

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
- All built-in tools are exposed when ra runs as MCP server
