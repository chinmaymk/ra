# Middleware

Lifecycle hooks that let you intercept and modify every step of the [agent loop](/core/agent-loop). Define them inline in config, as TypeScript files, or as shell scripts / arbitrary binaries.

```yaml
# ra.config.yml
agent:
  middleware:
    beforeModelCall:
      - "(ctx) => { console.log('Calling model...'); }"
    afterToolExecution:
      - "./middleware/log-tools.ts"
    beforeToolExecution:
      - "./middleware/policy-check.sh"
      - "shell: python3 ./middleware/guardrail.py --strict"
```

Each middleware is an `async (ctx) => void` function. Every context object has `stop()` and `signal`:

```ts
ctx.stop()          // halt the agent loop
ctx.signal.aborted  // check if already stopped
```

## Hooks

| Hook | When | Context type |
|------|------|--------------|
| `beforeLoopBegin` | Once at loop start | `LoopContext` |
| `beforeModelCall` | Before each LLM call | `ModelCallContext` |
| `onStreamChunk` | Per streaming token | `StreamChunkContext` |
| `afterModelResponse` | After model finishes | `ModelCallContext` |
| `beforeToolExecution` | Before each tool call | `ToolExecutionContext` |
| `afterToolExecution` | After each tool returns | `ToolResultContext` |
| `afterLoopIteration` | After each full iteration | `LoopContext` |
| `afterLoopComplete` | After the final iteration | `LoopContext` |
| `onError` | On exceptions | `ErrorContext` |

Middleware runs in array order. Multiple hooks of the same type are executed sequentially.

## Context types

### LoopContext

Available on all hooks via `ctx.loop` (or directly for loop-level hooks like `beforeLoopBegin`, `afterLoopIteration`, `afterLoopComplete`).

```ts
{
  messages: IMessage[]     // full conversation history
  iteration: number        // current loop iteration (0-indexed)
  maxIterations: number
  sessionId: string
  usage: {
    inputTokens: number
    outputTokens: number
  }
  stop(): void
  signal: AbortSignal
}
```

### ModelCallContext

Used by `beforeModelCall` and `afterModelResponse`. You can inspect or modify the request before it's sent.

```ts
{
  request: {
    model: string
    messages: IMessage[]
    tools?: ITool[]
    thinking?: 'low' | 'medium' | 'high'  // resolved from ThinkingMode
  }
  loop: LoopContext
}
```

### StreamChunkContext

Used by `onStreamChunk`. Fires for every chunk the model streams back.

```ts
{
  chunk:
    | { type: 'text'; delta: string }
    | { type: 'thinking'; delta: string }
    | { type: 'tool_call_start'; id: string; name: string }
    | { type: 'tool_call_delta'; id: string; argsDelta: string }
    | { type: 'tool_call_end'; id: string }
    | { type: 'done'; usage?: { inputTokens: number; outputTokens: number } }
  loop: LoopContext
}
```

### ToolExecutionContext

Used by `beforeToolExecution`. Fires before each tool is invoked.

```ts
{
  toolCall: { id: string; name: string; arguments: string }
  loop: LoopContext
}
```

### ToolResultContext

Used by `afterToolExecution`. Fires after each tool returns.

```ts
{
  toolCall: { id: string; name: string; arguments: string }
  result: { toolCallId: string; content: string; isError?: boolean }
  loop: LoopContext
}
```

### ErrorContext

Used by `onError`. Fires when an exception occurs during the loop.

```ts
{
  error: Error
  phase: 'model_call' | 'tool_execution' | 'stream'
  loop: LoopContext
}
```

## File-based middleware

Export a default async function from a `.ts` or `.js` file:

```ts
// middleware/audit-log.ts
export default async (ctx) => {
  await Bun.file('audit.jsonl').writer().write(JSON.stringify({
    tool: ctx.toolCall.name,
    args: ctx.toolCall.arguments,
    result: ctx.result.content,
    timestamp: Date.now()
  }) + '\n')
}
```

Reference it by path in config:

```yaml
agent:
  middleware:
    afterToolExecution:
      - "./middleware/audit-log.ts"
```

Paths can be relative (to project root), absolute, or use `~` for home directory. Both `.ts` and `.js` files are supported — TypeScript is transpiled automatically by Bun.

## Inline middleware

Inline expressions are TypeScript strings in your config. They're transpiled at load time. Best for simple, single-expression hooks.

```yaml
agent:
  middleware:
    beforeModelCall:
      - "(ctx) => { console.log('Messages:', ctx.request.messages.length); }"
    onStreamChunk:
      - "(ctx) => { process.stdout.write(ctx.chunk.type === 'text' ? ctx.chunk.delta : '') }"
    onError:
      - "(ctx) => { console.error(`[${ctx.phase}]`, ctx.error.message); }"
```

## Shell middleware

Run any shell script or binary as middleware. ra pipes the context as JSON to **stdin** and reads an optional JSON response from **stdout**. **stderr** is logged at debug level.

Scripts with known extensions (`.sh`, `.bash`, `.zsh`, `.py`, `.rb`, `.pl`, `.php`, `.lua`, `.r`) are **auto-detected** — no prefix needed:

```yaml
agent:
  middleware:
    beforeToolExecution:
      - "./middleware/policy-check.sh"       # auto-detected by .sh extension
      - "./middleware/guardrail.py"           # auto-detected by .py extension
```

Use the `shell:` prefix when you need to pass a command with arguments, or run a binary without a recognized extension:

```yaml
agent:
  middleware:
    beforeToolExecution:
      - "shell: python3 ./middleware/guardrail.py --strict"
      - "shell: /usr/local/bin/my-checker"
```

### Protocol

**Input (stdin)** — JSON object:

```json
{
  "hook": "beforeToolExecution",
  "loop": {
    "iteration": 0,
    "maxIterations": 10,
    "sessionId": "abc-123",
    "usage": { "inputTokens": 1200, "outputTokens": 300 },
    "resumed": false,
    "messages": [...]
  },
  "toolCall": {
    "id": "tc_1",
    "name": "Bash",
    "arguments": "{\"command\":\"rm -rf /\"}"
  }
}
```

The exact fields depend on which hook the middleware is registered for. For example, `beforeModelCall` includes `request` (with `model`, `messages`, `tools`), while `afterToolExecution` includes both `toolCall` and `result`.

**Output (stdout)** — optional JSON object with mutations to apply:

```json
{
  "stop": true,
  "deny": "blocked by policy",
  "context": {
    "messages": [...]
  }
}
```

| Field | Type | Effect |
|-------|------|--------|
| `stop` | `true` or `string` | Calls `ctx.stop()` to halt the loop. String value is the reason. |
| `deny` | `string` | Calls `ctx.deny(reason)` — only valid in `beforeToolExecution`. |
| `context.messages` | `IMessage[]` | Replaces messages (for `beforeLoopBegin` hooks). |
| `context.request.messages` | `IMessage[]` | Replaces request messages (for `beforeModelCall` hooks). |
| `context.request.tools` | `ITool[]` | Replaces request tools (for `beforeModelCall` hooks). |

If stdout is empty or the script produces no output, no mutations are applied.

**Exit code** — a non-zero exit code throws an error and halts the middleware chain.

### Examples

**Shell — block dangerous commands:**

```bash
#!/bin/sh
# middleware/policy-check.sh
input=$(cat)
args=$(echo "$input" | jq -r '.toolCall.arguments // ""')
if echo "$args" | grep -q 'rm -rf'; then
  echo '{"deny": "rm -rf is not allowed"}'
else
  echo '{}'
fi
```

**Python — token budget enforcer:**

```python
#!/usr/bin/env python3
# middleware/token-budget.py
import json, sys

ctx = json.load(sys.stdin)
usage = ctx.get("loop", {}).get("usage", {})
total = usage.get("inputTokens", 0) + usage.get("outputTokens", 0)

if total > 100_000:
    json.dump({"stop": "token budget exceeded"}, sys.stdout)
```

### Path resolution

The command after `shell:` follows the same path resolution as file middleware — relative paths resolve against the project root, `~/` expands to home directory, and absolute paths are used as-is. The first token is the command; remaining tokens are arguments. Quoted strings (single or double) are treated as a single argument.

## Stopping the loop

Any middleware can call `ctx.stop()` to halt the agent loop early:

```ts
// middleware/token-budget.ts — stop if we've used too many tokens
export default async (ctx) => {
  if (ctx.loop.usage.inputTokens + ctx.loop.usage.outputTokens > 100_000) {
    ctx.stop()
  }
}
```

## Timeout

All hooks support a configurable timeout via `toolTimeout` (default: 2 minutes). If a middleware function exceeds the timeout, the loop continues without waiting.

## See also

- [The Agent Loop](/core/agent-loop) — understand the loop lifecycle
- [Dynamic Prompts](/recipes/dynamic-prompts) — advanced `beforeModelCall` patterns
- [Context Control](/core/context-control) — how context flows through the loop
- [Configuration](/configuration/) — `toolTimeout` and middleware config
