# Test Cleanup & Integration Layer Design

Date: 2026-03-04

## Overview

Two-phase test improvement:
1. Remove low-value tests that add noise without catching regressions
2. Add meaningful unit tests for critical untested behaviors
3. Add integration tests that run against the compiled binary with a mock LLM server

---

## Part 1 — Deletions

### Entire files to delete
- `tests/providers/types.test.ts` — TypeScript type shape checks; compilation catches these
- `tests/providers/registry.test.ts` — only asserts `.name`; covered inside each provider test
- `tests/e2e/agent.test.ts` — not actually e2e; just `provider.name === 'anthropic'`

### Systematic purges across all provider files (openai, anthropic, google, ollama, bedrock)
- All `has correct name` tests — single string assertion, no behavioral value
- All `omits X when not provided` / `does not include X when not set` — assert `undefined` on a trivial branch
- All `defaults to 0 when not present` — same pattern
- Duplicate `extractSystemMessages` tests (appears in both google and anthropic)

### Specific bad tests
- `tests/mcp/client.test.ts` — "creates instance" checks `typeof` on methods; replace with a connection test
- `tests/config/index.test.ts:87-91` — `expect(c).toBeDefined()` smoke test
- `tests/interfaces/repl.test.ts:42-47` — comment says "No error means success", no real assertion
- `tests/skills/runner.test.ts` — exact duplicate `.ts` run test across describe blocks
- `tests/interfaces/tui.test.ts` — ANSI escape constant tests (re-hardcode values in test)
- `tests/agent/middleware.test.ts:65-80` — tests `AbortController` built-in behavior, not our code
- `tests/interfaces/http.test.ts:207-217` — stop-without-start no-op test
- `tests/mcp/server.test.ts:81-91` — stop test can pass vacuously

### Consolidations
- `tests/utils/mime.test.ts` — 15 individual tests → 3 `test.each` tables (image types, text types, unknown)
- `tests/middleware/loader.test.ts` — merge two near-identical multi-entry tests into one

---

## Part 2 — New Meaningful Unit Tests

| Module | Test | Why |
|--------|------|-----|
| `agent/loop.ts` | Tool call with malformed JSON arg → error message surfaced, not crash | Currently fails silently |
| `agent/loop.ts` | `stop()` mid tool execution → remaining tools still drain cleanly | Resource leak risk |
| `agent/context-compaction.ts` | Summarization throws → original messages remain intact | Silent failure risk |
| `agent/context-compaction.ts` | Boundary adjusts to not split assistant+tool_result group | Currently uses vacuous conditional assertion |
| `config/index.ts` | `deepMerge` with array value → array replaced, not merged | Array overwrite behavior |
| `config/index.ts` | Env var with invalid number → falls back gracefully | Config corruption risk |
| `storage/sessions.ts` | `prune()` respects `maxSessions` exactly (off-by-one check) | Data loss risk |
| `providers/anthropic.ts` | Stream with thinking delta before text delta → correct chunk ordering | Thinking mode regression |
| `agent/tool-registry.ts` | `execute()` unknown tool → throws with useful message | Agent loop crash on bad tool name |

---

## Part 3 — Integration Tests on Compiled Binary

### Directory structure

```
tests/integration/
  helpers/
    mock-llm-server.ts    # Multi-provider mock HTTP server
    binary.ts             # Binary spawn + capture helpers
  cli.test.ts             # CLI one-shot mode
  http.test.ts            # HTTP interface
  repl.test.ts            # Interactive REPL mode
  mcp.test.ts             # MCP client/server
  agentic-flow.test.ts    # Full end-to-end scenarios
```

### mock-llm-server.ts

Single Bun HTTP server routing by path to emulate all three provider APIs:
- `POST /anthropic/v1/messages` — Anthropic SSE (`content_block_delta` events)
- `POST /openai/v1/chat/completions` — OpenAI SSE (`data: {"choices":[...]}`)
- `GET /google/v1beta/models/:model:streamGenerateContent` — Google SSE

API: `server.enqueue([...responses])` where each response is `{ type: 'text' | 'tool_call' | 'thinking' | 'error', ... }`.
Server picks a random free port; exposes env vars `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL`, `GOOGLE_BASE_URL`.

### binary.ts

Wraps `Bun.spawn('dist/ra', args, { env })` with:
- `run(args, env)` → `{ stdout, stderr, exitCode }`
- `spawn(args, env)` → process handle with `sendStdin(text)`, `readLine()`, `kill()`
- Auto-sets `ANTHROPIC_BASE_URL` (and openai/google equivalents) to mock server

### cli.test.ts
- Simple prompt → text response → stdout contains text, exit 0
- Tool call → tool executes → second response → final output correct
- Provider error → exit nonzero, stderr has message
- `--max-iterations 1` with always-tool-calling LLM → exits after 1 iteration

### http.test.ts
- `POST /chat/sync` → returns `{ response: "..." }` JSON
- `POST /chat` SSE stream → emits correctly formatted `data:` events
- Missing auth token → 401
- Wrong auth token → 401
- `GET /sessions` → empty initially, populated after sync call
- Session continuity: two sync calls with same session → second request includes prior history

### repl.test.ts
- Type message → LLM responds → stdout shows response
- `/clear` → next message has no prior context (verified by mock server receiving only 1 message)
- `/save` then `/resume <id>` → history restored across binary invocations
- `/attach <file>` → file content present in request sent to mock server
- `/skill <name>` with fixture skill dir → skill output injected as assistant message
- CTRL+C during streaming → clean exit, no zombie processes

### mcp.test.ts
- Start fixture MCP server (stdio) alongside mock LLM
- Binary connects via `--mcp-servers`, discovers tools
- LLM response triggers MCP tool → binary calls it → sends result back
- Verify final output includes tool result
- MCP server exits abruptly → binary handles disconnect gracefully

### agentic-flow.test.ts
- **Multi-turn tool loop**: LLM calls tool → result back → calls another tool → result back → final text. Verify full message sequence.
- **Context compaction**: Enough iterations to exceed threshold → binary calls LLM to summarize → resumes → final response correct.
- **Parallel tool calls**: LLM returns two tool calls in one response → both execute concurrently → both results in single message.
- **Max iterations**: LLM always returns tool calls → binary stops at `--max-iterations` limit → exits cleanly.
- **Middleware hooks**: Fixture middleware file records all hook invocations → verify all 8 hooks fire in correct order.
- **Session persistence**: Two binary runs with same `--session` ID → second run receives prior messages (verified by mock server).

### Build strategy
Tests check if `dist/ra` exists; build if not. CI always runs `bun run compile` before `bun test tests/integration/`. Integration tests run separately from unit tests.
