# Built-in Tools for Ra

## Overview

Add 14 built-in tools to ra so it's useful out of the box for filesystem, shell, network, and agent interaction tasks. Tools are native `ITool` implementations (not MCP), but are also exposed via MCP when ra runs as an MCP server.

## Tool Set

### Filesystem (10 tools)

| Tool | Purpose |
|---|---|
| `read_file` | Read file contents with optional line range. Returns content with line numbers. |
| `write_file` | Create or overwrite a file with given content. Creates parent directories. |
| `update_file` | Search-and-replace within a file. Takes `old_string` and `new_string`. |
| `append_file` | Append content to end of a file. Creates the file if it doesn't exist. |
| `list_directory` | List files and directories at a path. Returns structured JSON. |
| `search_files` | Recursive content search (grep). Returns matching lines with file paths and line numbers. |
| `glob_files` | Find files matching a glob pattern. Returns list of matching paths. |
| `move_file` | Move or rename a file/directory. Cross-platform (avoids `mv` vs `Move-Item`). |
| `copy_file` | Copy a file or directory recursively. Cross-platform. |
| `delete_file` | Remove a file or directory. Cross-platform. |

### Shell (1 tool, platform-detected)

| Tool | Purpose |
|---|---|
| `execute_bash` | Run a shell command via bash. Registered on unix/macOS only. |
| `execute_powershell` | Run a shell command via PowerShell. Registered on Windows only. |

Only one is registered per platform. The tool name tells the LLM which syntax to use.

### Network (1 tool)

| Tool | Purpose |
|---|---|
| `web_fetch` | HTTP request (GET/POST/etc). Returns status, headers, body. |

### Agent Interaction (2 tools)

| Tool | Purpose |
|---|---|
| `ask_user` | Ask the user a question. Suspends the loop until the user responds. |
| `checklist` | Persistent task tracking. Actions: create, add, check, uncheck, remove, list. |

**Total: 14 tools** (13 registered at any time — shell tool is platform-specific).

## Tool Descriptions

Each tool's `description` field must be fully self-contained — it's the only context the LLM has. No system prompt provides OS info or usage guidance. Descriptions should cover:

- What the tool does
- When to use it (and when not to)
- Input format and constraints
- Output format
- Platform behavior (for shell tool, the name itself signals the platform)

## Config

Add `builtinTools` to `RaConfig`:

```typescript
builtinTools: boolean  // default: false
```

- `ra.config.json`: `"builtinTools": true`
- Env var: `RA_BUILTIN_TOOLS=true`
- CLI flag: `--builtin-tools`

When `false`, no built-in tools are registered. Tools only come from MCP clients (current behavior).

## File Structure

```
src/tools/
  index.ts              # registerBuiltinTools(registry, options)
  read-file.ts
  write-file.ts
  update-file.ts
  append-file.ts
  list-directory.ts
  search-files.ts
  glob-files.ts
  move-file.ts
  copy-file.ts
  delete-file.ts
  execute-bash.ts
  execute-powershell.ts
  web-fetch.ts
  ask-user.ts
  checklist.ts
```

Each file exports a function that returns an `ITool` (or the tool object directly).

## Registration

In `src/index.ts`, after creating the `ToolRegistry`:

```typescript
if (config.builtinTools) {
  registerBuiltinTools(tools)
}
```

`registerBuiltinTools` checks `process.platform` and registers either `execute_bash` or `execute_powershell`.

## ask_user: Suspend/Resume

`ask_user` doesn't use callbacks or special hooks. It works via session suspend/resume:

1. Agent calls `ask_user({ question: "..." })`
2. The tool returns the question as its result
3. The loop breaks (tool signals the loop to stop, like a normal termination)
4. Messages are saved to session storage
5. The interface surfaces the question + session_id to the caller

**Resuming:**
- Load messages from session storage (existing `--resume` flow)
- Append the user's answer as a new user message
- Run the loop again — it picks up where it left off

**Per interface:**
- **CLI**: Prints question, exits with session_id. User resumes with `ra --resume <id> "answer"`.
- **REPL**: Prints question, waits for next input, resumes automatically.
- **HTTP**: Returns question + session_id in response/SSE. Client POSTs answer with same session_id.

## checklist Tool

Single tool with an `action` parameter:

| Action | Input | Description |
|---|---|---|
| `create` | `{ title }` | Create a new checklist, returns checklist_id |
| `add` | `{ checklist_id, item }` | Add an item |
| `check` | `{ checklist_id, index }` | Mark item as done |
| `uncheck` | `{ checklist_id, index }` | Mark item as not done |
| `remove` | `{ checklist_id, index }` | Remove an item |
| `list` | `{ checklist_id }` | Return all items with status |

Checklists are stored in-memory within the agent loop's lifetime. They don't persist across sessions.

## MCP Exposure

When ra runs as MCP server (`--mcp` or `--mcp-stdio`), built-in tools are automatically registered and exposed as MCP tools — no extra flag needed. `builtinTools` config still controls whether they're registered.

Exception: `ask_user` is not exposed in MCP server mode (the MCP client is the caller, not an interactive user).

## Cross-Platform

Filesystem tools (`read_file`, `write_file`, etc.) use Node.js `fs` / Bun file APIs which are cross-platform. No shell commands internally.

Shell tool is platform-detected:
- `process.platform !== 'win32'` → register `execute_bash`
- `process.platform === 'win32'` → register `execute_powershell`
