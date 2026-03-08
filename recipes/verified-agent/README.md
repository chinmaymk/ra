# Verified Agent

An agent recipe that adds three integrity layers to ra:

| Layer | Middleware | What it does |
|-------|-----------|--------------|
| **Deterministic workflows** | `workflow-guard.ts` | Enforces tool execution ordering via dependency graph |
| **Verifiable outputs** | `hash-chain.ts` | SHA-256 hash chain over all messages — tamper-evident log |
| **Traceable decisions** | `decision-log.ts` | Structured audit trail of every model call, tool use, and error |

## Quick start

```bash
cd recipes/verified-agent
ra --config ra.config.yaml "read the README and summarize it"
```

## Session output

After a run, your session directory contains:

```
.ra/sessions/<id>/
├── meta.json          # Session metadata
├── messages.jsonl     # Conversation history
├── hashchain.jsonl    # Hash chain (verifiable outputs)
└── decisions.jsonl    # Decision audit trail (traceable decisions)
```

## Configuring a workflow

Set the `RA_WORKFLOW` env var with a JSON array of steps:

```bash
export RA_WORKFLOW='[
  { "id": "find",  "tool": "glob" },
  { "id": "read",  "tool": "read",  "requires": ["find"] },
  { "id": "write", "tool": "write", "requires": ["read"] }
]'

ra --config ra.config.yaml "find and fix the bug in src/main.ts"
```

Tools not in the workflow run freely. Tools in the workflow are blocked until their `requires` dependencies have completed. When blocked, the model receives a message explaining what to do first.

## Verifying a session

```typescript
import { verify } from "./middleware/hash-chain"

const result = await verify("session-id-here")
// { valid: true, entries: 42 }
// or { valid: false, entries: 42, brokenAt: 17 }
```

## How the hash chain works

Each assistant response and tool result gets a SHA-256 hash:

```
hash[n] = SHA-256(hash[n-1] + SHA-256(content))
```

The first entry chains from a genesis hash (`0x00...00`). If any entry in `hashchain.jsonl` is modified, all subsequent hashes become invalid.

## How the decision log works

Every middleware hook emits a structured record to `decisions.jsonl`:

- `calling_model` — model name, available tools, message count
- `model_responded` — response preview, tool calls chosen, token usage
- `tool_starting` — tool name, arguments preview
- `tool_completed` — result preview, error status
- `iteration_complete` — iteration number, cumulative usage
- `loop_complete` — total iterations, final usage
- `error_occurred` — phase, error message, stack trace
