# Permissions

ra ships with a regex-based permissions system that controls what tools can do. Define allow and deny patterns per tool, per field — the agent gets clear error messages when blocked, so it can adjust.

By default, all tools are allowed (no rules configured). Add rules to restrict specific tools.

```yaml
# ra.config.yml
agent:
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun "]
          deny: ["--force", "--hard", "--no-verify"]
      - tool: Write
        path:
          allow: ["^src/", "^tests/"]
          deny: ["\\.env"]
        content:
          deny: ["API_KEY", "SECRET"]
      - tool: DeleteFile
        path:
          deny: [".*"]
```

## How it works

Each rule targets a **tool name** and one or more **fields** from that tool's input schema. Each field has optional `allow` and `deny` arrays of regex patterns.

Evaluation order per tool call:

1. If `no_rules_rules: true` — allow everything, skip all checks
2. Find all rules matching this tool name
3. For each field rule, test the field's value against the regexes
4. **Deny takes priority** — if any deny regex matches, the call is blocked
5. If an allow list exists and nothing matches, the call is blocked
6. If no rules match this tool, fall through to `default_action` (default: `allow`)

When a tool call is denied, the model receives an error result with a clear message explaining which rule was triggered. The loop continues — the model can retry with a different approach.

## Configuration

### `permissions.no_rules_rules`

When `true`, disables all permission checks. All tools are allowed unconditionally. Use this to explicitly opt out of the permissions system.

```yaml
agent:
  permissions:
    no_rules_rules: true
```

### `permissions.default_action`

What happens when a tool has no matching rules. Default: `allow`.

```yaml
agent:
  permissions:
    default_action: deny  # block tools with no rules
```

Set to `deny` if you want an allowlist-only approach — only tools with explicit rules can execute.

### `permissions.rules`

Array of rule objects. Each rule has:

- `tool` (required) — the registered tool name to match (e.g. `Bash`, `Write`, `Read`)
- Any other key — a field name from the tool's input schema, mapped to `{ allow?: string[], deny?: string[] }`

```yaml
agent:
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git ", "^bun ", "^tsc$"]
          deny: ["--force", "--hard", "\\|\\s*(bash|sh)"]
      - tool: Write
        path:
          allow: ["^src/", "^tests/"]
      - tool: WebFetch
        url:
          deny: ["localhost", "127\\.0\\.0\\.1", "169\\.254\\."]
```

Multiple rules for the same tool are evaluated in order. All rules for a tool must pass.

## Tool field reference

Each built-in tool has specific fields you can write rules against. These are the same fields documented in the tool's input schema.

| Tool | Key fields | Description |
|------|-----------|-------------|
| `Bash` | `command`, `cwd` | Shell command and working directory |
| `PowerShell` | `command`, `cwd` | PowerShell command and working directory |
| `Read` | `path` | File path to read |
| `Write` | `path`, `content` | File path and content to write |
| `Edit` | `path`, `old_string`, `new_string` | File path and replacement strings |
| `AppendFile` | `path`, `content` | File path and content to append |
| `DeleteFile` | `path` | File path to delete |
| `MoveFile` | `source`, `destination` | Source and destination paths |
| `CopyFile` | `source`, `destination` | Source and destination paths |
| `LS` | `path` | Directory path |
| `Grep` | `path`, `pattern` | Search directory and pattern |
| `Glob` | `path`, `pattern` | Search directory and glob |
| `WebFetch` | `url`, `method`, `body` | URL, HTTP method, request body |

## Examples

### Allow only safe git commands

```yaml
agent:
  permissions:
    rules:
      - tool: Bash
        command:
          allow: ["^git (status|diff|log|add|commit|push|pull|fetch|branch|checkout|stash)"]
          deny: ["--force", "-f$", "--hard", "--no-verify"]
```

### Restrict file operations to project directory

```yaml
agent:
  permissions:
    rules:
      - tool: Write
        path:
          allow: ["^src/", "^tests/", "^docs/"]
      - tool: DeleteFile
        path:
          deny: [".*"]  # block all deletes
      - tool: MoveFile
        source:
          allow: ["^src/", "^tests/"]
        destination:
          allow: ["^src/", "^tests/"]
```

### Block secrets in file content

```yaml
agent:
  permissions:
    rules:
      - tool: Write
        content:
          deny: ["(?i)api.?key\\s*=", "(?i)secret\\s*=", "(?i)password\\s*="]
      - tool: AppendFile
        content:
          deny: ["(?i)api.?key\\s*=", "(?i)secret\\s*="]
```

### Block network access to internal services

```yaml
agent:
  permissions:
    rules:
      - tool: WebFetch
        url:
          deny: ["localhost", "127\\.0\\.0\\.1", "10\\.", "172\\.(1[6-9]|2[0-9]|3[01])\\.", "192\\.168\\."]
```

### Lockdown mode — deny everything except reads

```yaml
agent:
  permissions:
    default_action: deny
    rules:
      - tool: Read
        path: {}          # empty rule = allow all (no deny, no allow constraints)
      - tool: LS
        path: {}
      - tool: Grep
        path: {}
      - tool: Glob
        path: {}
```

Tools with a rule entry but no field constraints are allowed unconditionally when `default_action: deny`.

## How the model sees denials

When a tool call is denied, the model receives an error result like:

```
Permission denied: 'Bash' field 'command' matches deny rule /--force/
```

or:

```
Permission denied: 'Write' field 'path' did not match any allow rule
```

This gives the model enough context to adjust its approach — for example, dropping a `--force` flag or choosing a different file path.

## See also

- [Built-in Tools](/tools/) — tool schemas and field names
- [Middleware](/middleware/) — `beforeToolExecution` hook (permissions uses this internally)
- [Configuration](/configuration/) — full config reference
