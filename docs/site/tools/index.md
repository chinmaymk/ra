# Built-in Tools

ra ships with built-in tools that give the agent the ability to interact with the filesystem, run shell commands, make HTTP requests, spawn parallel sub-agents, and communicate with the user. An ephemeral [scratchpad](#scratchpad) is registered by default for compaction-safe note-taking. When [memory](/configuration/#agent-memory) is enabled, additional memory tools are registered for long-term persistence. All built-in tools are registered by default and can be individually configured or disabled via the [`tools`](/configuration/#agent-tools) config section.

Tools are self-describing — each includes a detailed schema and description so the model knows when and how to use them. You can further guide tool usage through system prompts or [middleware](/middleware/).

```yaml
# ra.config.yml — tools are enabled by default
agent:
  tools:
    builtin: true
```

When ra runs as an [MCP server](/modes/mcp), all built-in tools are automatically exposed as MCP tools.

## Filesystem

### `Read`

Read the contents of a file. Returns content with line numbers prefixed (e.g. `1: first line`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Absolute or relative path to the file |
| `offset` | number | no | Start reading from this line number (1-based) |
| `limit` | number | no | Maximum number of lines to return |

```json
{ "path": "src/index.ts", "offset": 10, "limit": 20 }
```

### `Write`

Create or overwrite a file. Parent directories are created automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to the file to write |
| `content` | string | yes | Content to write |

```json
{ "path": "src/hello.ts", "content": "export const hello = 'world'" }
```

### `Edit`

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

### `AppendFile`

Append content to the end of a file. Creates the file and parent directories if they don't exist. Does not add any separator — include a newline in the content if needed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to the file |
| `content` | string | yes | Content to append |

### `LS`

List files and directories at a path. Directories have a trailing `/`. Set `recursive=true` to list nested contents up to a given depth.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory to list |
| `recursive` | boolean | no | Recurse into subdirectories (default: `false`) |
| `depth` | number | no | Max recursion depth, 1–5 (default: `3`, only used when `recursive` is `true`) |

```json
{ "path": "src", "recursive": true, "depth": 2 }
```

### `Grep`

Search for a text pattern across files recursively. Returns matches in `path:line:content` format. Skips `node_modules` and `.git`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory to search in |
| `pattern` | string | yes | Text to search for (plain string, not regex) |
| `include` | string | no | Filename glob filter, e.g. `"*.ts"` |

```json
{ "path": "src", "pattern": "TODO", "include": "*.ts" }
```

### `Glob`

Find files matching a glob pattern. Supports `*`, `**`, and `?`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Directory to search in |
| `pattern` | string | yes | Glob pattern, e.g. `"**/*.test.ts"` |

### `MoveFile`

Move or rename a file or directory. Creates parent directories at the destination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | yes | Current path |
| `destination` | string | yes | New path |

### `CopyFile`

Copy a file or directory. Directories are copied recursively. Creates parent directories at the destination.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source` | string | yes | Path to copy from |
| `destination` | string | yes | Path to copy to |

### `DeleteFile`

Delete a file or directory. Directories are deleted recursively. Irreversible.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | yes | Path to delete |

## Shell

ra registers a platform-specific shell tool based on the OS it's running on. Only one is available at a time.

### `Bash` <Badge type="info" text="macOS / Linux" />

Execute a bash command and return combined stdout/stderr output. The description includes the detected OS (macOS or Linux).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `command` | string | yes | Bash command to execute |
| `cwd` | string | no | Working directory |
| `timeout` | number | no | Timeout in milliseconds (default: 30000) |

```json
{ "command": "git status", "cwd": "/home/user/project" }
```

### `PowerShell` <Badge type="info" text="Windows" />

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

### `WebFetch`

Make an HTTP request and return the response as JSON with `status`, `headers`, and `body` fields.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | yes | URL to fetch |
| `method` | string | no | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, or `DELETE` (default: `GET`) |
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

## Scratchpad

When built-in tools are enabled, ra registers an ephemeral key-value scratchpad that survives [context compaction](/core/context-control#smart-context-compaction). Entries are re-injected before every model call via middleware, so the agent never loses them even as older messages are summarized. The scratchpad is **not** persisted across sessions — use [memory tools](#memory) for long-term storage.

Disable the scratchpad with:

```yaml
agent:
  tools:
    scratchpad:
      enabled: false
```

### `scratchpad_write`

Store a key-value pair in the scratchpad. Writing to an existing key overwrites the previous value. Use this for checklists, plans, intermediate results, or any state that must outlive compaction.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | Short descriptive identifier, e.g. `"checklist"`, `"plan"` |
| `value` | string | yes | Content to store (plain text, markdown, JSON, etc.) |

```json
{ "key": "checklist", "value": "- [x] step 1\n- [ ] step 2\n- [ ] step 3" }
```

### `scratchpad_delete`

Remove an entry from the scratchpad by key. Use when an entry is no longer needed to keep the scratchpad clean.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `key` | string | yes | Key of the entry to remove |

```json
{ "key": "checklist" }
```

## Parallelization

### `Agent`

Fork parallel copies of the agent to work on independent tasks simultaneously. Each fork inherits the parent's model, system prompt, tools, and thinking level — it's the same agent with a fresh conversation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tasks` | array | yes | Tasks to run in parallel |
| `tasks[].task` | string | yes | The task prompt for the fork |

```json
{
  "tasks": [
    { "task": "Read src/auth.ts and summarize the authentication flow" },
    { "task": "Find all TODO comments in the codebase" },
    { "task": "Check for unused exports in src/utils/" }
  ]
}
```

Returns `{ results, usage }` where each result has `task`, `status`, `result`, `iterations`, and `usage`. Aggregate usage rolls up into the parent's token tracking automatically.

`Agent` is excluded from forks — nesting is depth-limited (default: 2) to prevent infinite recursion. All other tools (including memory) are inherited. Task failures don't affect siblings.

Forks honor the parent's `maxIterations`. Use `maxConcurrency` (default: 4) to control how many forks run in parallel.

## MCP

When [MCP clients](/modes/mcp) are configured, all MCP tools are registered with server-prefixed names (`github__search`) to avoid conflicts. When `mcpLazySchemas` is enabled (the default), schemas are additionally stripped — on the first call to each tool, ra returns the full schema as an error, and the model retries with correct parameters. See [MCP](/modes/mcp#server-prefixed-tool-names) for details.

## Memory

When [memory](/configuration/#agent-memory) is enabled, three additional tools are registered.

### `memory_save`

Save a fact to persistent memory for future conversations. Proactively saves user preferences, project decisions, corrections, and key context. To update an existing memory, the agent forgets the old version first, then saves the new one.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | string | yes | Self-contained fact, e.g. "User prefers tabs over spaces" |
| `tags` | string | no | Category: `preference`, `project`, `convention`, `team`, or `tooling` |

### `memory_search`

Search persistent memories by keyword. Recent memories are automatically injected at conversation start — this tool is for targeted lookups beyond the recalled set.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Full-text search keywords, e.g. "typescript tabs" or "deployment" |
| `limit` | number | no | Max results (default: 10) |

### `memory_forget`

Delete memories matching a search query. Used when the user corrects previous information, a fact becomes outdated, or before saving an updated version of an existing memory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search keywords to match memories to delete |
| `limit` | number | no | Max memories to delete (default: 10) |

## Configuring tools

The `tools` section lets you independently enable/disable tools and set per-tool constraints.

### Disable specific tools

```yaml
agent:
  tools:
    builtin: true
    WebFetch:
      enabled: false
    DeleteFile:
      enabled: false
```

### Constrain file tools with rootDir

Restrict filesystem tools to a specific directory. Paths outside this root are rejected at execution time.

```yaml
agent:
  tools:
    builtin: true
    Read:
      rootDir: "./src"
    Write:
      rootDir: "./src"
    Edit:
      rootDir: "./src"
```

### Limit Agent concurrency

```yaml
agent:
  tools:
    builtin: true
    Agent:
      maxConcurrency: 2
```

### Truncate large tool responses

When a tool returns more characters than `maxResponseSize`, the output is truncated at a newline boundary and a notice is appended telling the model to use more targeted queries. Default: `25000`.

```yaml
agent:
  tools:
    maxResponseSize: 50000   # raise the limit
```

```bash
RA_MAX_TOOL_RESPONSE_SIZE=50000 ra   # or via env var
```

### Disable all built-in tools

To run ra without any built-in tools (e.g., when using only [MCP tools](/modes/mcp)):

```yaml
agent:
  tools:
    builtin: false
```

```bash
ra --tools-builtin   # enable from CLI (enabled by default)
```

::: tip Legacy compatibility
The old `builtinTools: true/false` flag still works and is automatically converted to `tools.builtin`.
:::

## See also

- [The Agent Loop](/core/agent-loop) — how tools are executed within the loop
- [Middleware](/middleware/) — `beforeToolExecution` and `afterToolExecution` hooks
- [MCP](/modes/mcp) — connecting external MCP tools
