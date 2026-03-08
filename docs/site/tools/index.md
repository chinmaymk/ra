# Built-in Tools

ra ships with 14 built-in tools that give the agent the ability to interact with the filesystem, run shell commands, make HTTP requests, and communicate with the user. These are registered automatically when `builtinTools` is enabled (the default).

Tools are self-describing — each includes a detailed schema and description so the model knows when and how to use them. You can further guide tool usage through system prompts or [middleware](/middleware/).

```yaml
# ra.config.yml
builtinTools: true   # default
```

When ra runs as an [MCP server](/modes/mcp), all built-in tools (except `ask_user`) are automatically exposed as MCP tools.

## Filesystem

### `read_file`

Read the contents of a file. Returns content with line numbers prefixed (e.g. `1: first line`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute or relative path to the file |
| `offset` | number | no | Start reading from this line number (1-based) |
| `limit` | number | no | Maximum number of lines to return |

```json
{ "path": "src/index.ts", "offset": 10, "limit": 20 }
```

### `write_file`

Create or overwrite a file. Parent directories are created automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to the file to write |
| `content` | string | yes | Content to write |

```json
{ "path": "src/hello.ts", "content": "export const hello = 'world'" }
```

### `update_file`

Replace the first occurrence of a string in a file. The match must be exact, including whitespace and indentation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to the file to update |
| `old_string` | string | yes | Exact string to find |
| `new_string` | string | yes | Replacement string |

```json
{
  "path": "src/config.ts",
  "old_string": "const PORT = 3000",
  "new_string": "const PORT = 8080"
}
```

### `append_file`

Append content to the end of a file. Creates the file and parent directories if they don't exist. Does not add any separator — include a newline in the content if needed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to the file |
| `content` | string | yes | Content to append |

### `list_directory`

List files and directories at a path. Directories have a trailing `/`. Does not recurse into subdirectories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory to list |

### `search_files`

Search for a text pattern across files recursively. Returns matches in `path:line:content` format. Skips `node_modules` and `.git`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory to search in |
| `pattern` | string | yes | Text to search for (plain string, not regex) |
| `include` | string | no | Filename glob filter, e.g. `"*.ts"` |

```json
{ "path": "src", "pattern": "TODO", "include": "*.ts" }
```

### `glob_files`

Find files matching a glob pattern. Supports `*`, `**`, and `?`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory to search in |
| `pattern` | string | yes | Glob pattern, e.g. `"**/*.test.ts"` |

### `move_file`

Move or rename a file or directory. Creates parent directories at the destination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | yes | Current path |
| `destination` | string | yes | New path |

### `copy_file`

Copy a file or directory. Directories are copied recursively. Creates parent directories at the destination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | yes | Path to copy from |
| `destination` | string | yes | Path to copy to |

### `delete_file`

Delete a file or directory. Directories are deleted recursively. Irreversible.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to delete |

## Shell

ra registers a platform-specific shell tool based on the OS it's running on. Only one is available at a time.

### `execute_bash` <Badge type="info" text="macOS / Linux" />

Execute a bash command and return combined stdout/stderr output. The description includes the detected OS (macOS or Linux).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Bash command to execute |
| `cwd` | string | no | Working directory |
| `timeout` | number | no | Timeout in milliseconds (default: 30000) |

```json
{ "command": "git status", "cwd": "/home/user/project" }
```

### `execute_powershell` <Badge type="info" text="Windows" />

Execute a PowerShell command and return the output. Runs with `-NoProfile` for fast startup.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | PowerShell command to execute |
| `cwd` | string | no | Working directory |
| `timeout` | number | no | Timeout in milliseconds (default: 30000) |

```json
{ "command": "Get-ChildItem -Recurse -Filter *.ts" }
```

## Network

### `web_fetch`

Make an HTTP request and return the response as JSON with `status`, `headers`, and `body` fields.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to fetch |
| `method` | string | no | HTTP method (default: `GET`) |
| `headers` | object | no | Request headers as key-value pairs |
| `body` | string | no | Request body |

```json
{
  "url": "https://api.example.com/data",
  "method": "POST",
  "headers": { "Authorization": "Bearer token" },
  "body": "{\"key\": \"value\"}"
}
```

## Agent Interaction

### `ask_user`

Pause the agent loop and ask the user a question. The loop suspends until the user responds.

- **REPL** — the question is printed and the next input resumes the conversation
- **CLI** — the session ID is printed so the user can resume with `--resume`
- **HTTP** — an `ask_user` SSE event is emitted with the question and session ID

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `question` | string | yes | Question to ask the user |

This tool is **not exposed via MCP** since MCP clients manage their own user interaction.

### `checklist`

Track tasks with a checklist. The tool description dynamically updates to show remaining items and their indices, keeping the model aware of progress without needing to call `list`.

**Actions:**

| Action | Parameters | Description |
|--------|-----------|-------------|
| `add` | `item` (string) | Add an item to the checklist |
| `check` | `index` (number) | Mark an item as done (0-based) |
| `uncheck` | `index` (number) | Mark an item as not done |
| `remove` | `index` (number) | Remove an item |
| `list` | — | Show all items with status |

```json
{ "action": "add", "item": "Write tests" }
{ "action": "check", "index": 0 }
{ "action": "list" }
```

The dynamic description looks like:

> Track tasks with a checklist. Actions: "add" (item text), "check"/"uncheck"/"remove" (by 0-based index), "list" (show all). Remaining (2/3): 1: Fix bug, 2: Deploy

## Disabling built-in tools

To run ra without built-in tools (e.g., when using only [MCP tools](/modes/mcp)):

```yaml
builtinTools: false
```

```bash
ra --no-builtin-tools
```

## See also

- [The Agent Loop](/core/agent-loop) — how tools are executed within the loop
- [Middleware](/middleware/) — `beforeToolExecution` and `afterToolExecution` hooks
- [MCP](/modes/mcp) — connecting external MCP tools
