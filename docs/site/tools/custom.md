# Custom Tools

Define your own tools as TypeScript files, JavaScript files, or shell scripts. Custom tools work exactly like built-in tools — the model sees them in its tool list, can call them, and receives results through the same execution pipeline with full logging and tracing.

```yaml
# ra.config.yml
agent:
  tools:
    custom:
      - "./tools/deploy.ts"
      - "./tools/db-query.ts"
      - "./tools/health-check.sh"
```

## Writing a tool

Default-export an object with `name`, `description`, `execute`, and either `parameters` or `inputSchema`:

```ts
// tools/deploy.ts
export default {
  name: 'Deploy',
  description: 'Deploy the current branch to the staging environment',
  parameters: {
    branch: { type: 'string', description: 'Git branch to deploy' },
    dryRun: { type: 'boolean', description: 'Preview without deploying', optional: true },
  },
  async execute(input: unknown) {
    const { branch, dryRun } = input as { branch: string; dryRun?: boolean }
    if (dryRun) return `Would deploy branch "${branch}" to staging`
    // ... actual deploy logic
    return `Deployed "${branch}" to staging`
  },
}
```

The `description` drives model behavior — be specific about what the tool does and when to use it.

### Parameters shorthand

The `parameters` field is a simplified alternative to writing raw JSON Schema. Each key is a parameter name:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `'string' \| 'number' \| 'boolean' \| 'object' \| 'array'` | Parameter type |
| `description` | string | What this parameter does |
| `optional` | boolean | If `true`, parameter is not required (default: `false`) |
| `enum` | array | Restrict to specific values |
| `items` | object | For `array` type — describes each element |
| `properties` | object | For `object` type — nested properties |
| `default` | any | Default value |

Parameters are automatically converted to JSON Schema at load time. The example above becomes:

```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Git branch to deploy" },
    "dryRun": { "type": "boolean", "description": "Preview without deploying" }
  },
  "required": ["branch"]
}
```

### Using raw JSON Schema

For full control, use `inputSchema` directly instead of `parameters`:

```ts
export default {
  name: 'Query',
  description: 'Run a read-only SQL query',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SQL SELECT statement' },
      limit: { type: 'number', description: 'Max rows', default: 100 },
    },
    required: ['sql'],
  },
  async execute(input: unknown) {
    const { sql, limit } = input as { sql: string; limit?: number }
    // ... run query
    return JSON.stringify(rows)
  },
}
```

### Factory functions

If your tool needs initialization or closure state, export a factory function instead:

```ts
// tools/counter.ts
let count = 0

export default function createCounter() {
  return {
    name: 'Counter',
    description: 'Increment and return a counter',
    parameters: {},
    async execute() {
      return `count: ${++count}`
    },
  }
}
```

The factory is called once at load time. The returned object must have the same shape as a direct export. Async factories (`async function`) are also supported.

## Shell script tools

Any shell script or executable can be a custom tool. Scripts with known extensions (`.sh`, `.bash`, `.zsh`, `.py`, `.rb`, `.pl`, `.php`, `.lua`, `.r`) are **auto-detected** — no prefix needed:

```yaml
agent:
  tools:
    custom:
      - "./tools/health-check.sh"       # auto-detected by .sh extension
      - "./tools/lint.py"               # auto-detected by .py extension
```

Use the `shell:` prefix for commands with arguments or binaries without a recognized extension:

```yaml
agent:
  tools:
    custom:
      - "shell: python3 ./tools/analyze.py --strict"
      - "shell: /usr/local/bin/my-tool"
```

### Self-describing protocol

Shell tools self-describe by outputting JSON when called with `--describe`. During execution, they receive tool input as JSON on **stdin** and write the result to **stdout**.

```bash
#!/bin/bash
# tools/health-check.sh

if [ "$1" = "--describe" ]; then
  cat << 'EOF'
{
  "name": "HealthCheck",
  "description": "Check health of a service endpoint",
  "parameters": {
    "url": { "type": "string", "description": "URL to check" },
    "timeout": { "type": "number", "description": "Timeout in seconds", "optional": true }
  }
}
EOF
  exit 0
fi

# Read tool input from stdin
read -r input
url=$(echo "$input" | jq -r '.url')
timeout=$(echo "$input" | jq -r '.timeout // 5')

status=$(curl -s -o /dev/null -w '%{http_code}' --max-time "$timeout" "$url")
echo "HTTP $status for $url"
```

The `--describe` output supports the same fields as TypeScript tools:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Tool name the model calls |
| `description` | Yes | When and how to use this tool |
| `parameters` | No* | Parameters shorthand (same format as TS tools) |
| `inputSchema` | No* | Raw JSON Schema (use one or the other) |
| `timeout` | No | Per-tool timeout override (ms) |

\* If neither `parameters` nor `inputSchema` is provided, the tool accepts no arguments.

### Execution protocol

| Channel | Direction | Purpose |
|---------|-----------|---------|
| **stdin** | ra → script | JSON object with tool input arguments |
| **stdout** | script → ra | Tool result (returned as-is to the model) |
| **stderr** | script → ra | Logged at debug level |
| **exit code** | script → ra | Non-zero throws an error (sent to model as error result) |

### Python example

```python
#!/usr/bin/env python3
# tools/lint.py
import sys, json

if '--describe' in sys.argv:
    json.dump({
        'name': 'Lint',
        'description': 'Run linter on a file and return findings',
        'parameters': {
            'path': {'type': 'string', 'description': 'File path to lint'},
        },
    }, sys.stdout)
    sys.exit(0)

data = json.load(sys.stdin)
path = data['path']
# ... run linter ...
print(f'No issues found in {path}')
```

### Shared infrastructure with middleware

Shell tools use the same underlying detection and execution engine as [shell middleware](/middleware/#shell-middleware). The same extensions are auto-detected, the same process management applies (SIGTERM → SIGKILL after 3s on timeout), and the same path resolution rules work (relative to project root, `~/` for home, absolute paths).

## Combining with built-in tools

Custom tools are registered alongside built-in tools by default:

```yaml
agent:
  tools:
    builtin: true          # keep built-in tools (default)
    custom:
      - "./tools/deploy.ts"
```

To use only custom tools:

```yaml
agent:
  tools:
    builtin: false
    custom:
      - "./tools/deploy.ts"
      - "./tools/db-query.ts"
```

## Error handling

**At load time**, if a tool file fails to import or validate, it is logged as an error and skipped — other valid tools still load normally.

**At runtime**, thrown errors are caught and sent back to the model as error results (`isError: true`). The model sees the error message and can adjust its approach — no special handling needed in your code.

```ts
async execute(input: unknown) {
  const { path } = input as { path: string }
  if (!path.startsWith('/safe/')) throw new Error('Access denied: path outside safe directory')
  // ...
}
```

## Timeouts

Custom tools respect the global `toolTimeout` (default: 120s). Override per-tool with the `timeout` field:

```ts
export default {
  name: 'SlowBuild',
  description: 'Run the full build pipeline',
  parameters: {},
  timeout: 300_000,  // 5 minutes
  async execute() { /* ... */ },
}
```

## In recipes

Recipes can bundle custom tools. Relative paths in recipes are resolved against the recipe directory:

```yaml
# recipe ra.config.yml
agent:
  tools:
    custom:
      - "./tools/lint-check.ts"
```

When a recipe and user config both define custom tools, recipe tools are loaded first, followed by user tools.

## Observability

Custom tool execution is fully logged and traced, identical to built-in tools:

- **Logs**: `custom tools loaded`, `executing tool`, `tool execution complete` / `tool execution failed`
- **Traces**: `custom_tools.load` span at bootstrap, `agent.tool_execution` span per call

View in the [Inspector](/modes/inspector) or session log files (`logs.jsonl`, `traces.jsonl`).

## See also

- [Built-in Tools](/tools/) — the tools that ship with ra
- [Middleware](/middleware/) — intercept tool execution with `beforeToolExecution` / `afterToolExecution`
- [Permissions](/permissions/) — restrict what tools can do
- [MCP](/modes/mcp) — connect external tool servers
- [Configuration](/configuration/#agent-tools) — `tools` config reference
