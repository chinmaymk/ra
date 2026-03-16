# ra

ra is an agentic loop framework. One binary, multiple interfaces (CLI/REPL/HTTP/MCP), provider-portable across multiple LLM backends. Deployed as a single self-contained binary compiled via `bun build --compile` — no runtime dependencies needed.

## Quick Reference

```bash
bun run ra              # run from source
bun run compile         # build binary → dist/ra
bun tsc                 # type check (must pass, zero errors)
bun test                # run all tests
bun test tests/agent/   # run tests in a directory
```

## Project Structure

```
src/
  agent/       # Core loop, middleware chain, tool registry, context compaction
  providers/   # LLM adapters: anthropic, openai, google, ollama, bedrock, azure
  tools/       # Built-in tools (filesystem, shell, network, agent interaction)
  config/      # Layered config: defaults → file → env → CLI flags
  interfaces/  # Entry points: cli, repl, http, mcp
  skills/      # Skill loader, runner, installer
  middleware/   # Middleware file loader
  context/     # Context file discovery and pattern resolution
  mcp/         # MCP client + server
  memory/      # SQLite-backed persistent memory
  storage/     # JSONL session persistence
  utils/       # Shared utilities
tests/         # Mirrors src/ structure
skills/        # Built-in skills (code-review, architect, planner, debugger, code-style, writer)
recipes/       # Complete agent configurations (coding-agent, code-review-agent)
```

## Architecture

The core loop (`src/agent/loop.ts`) runs: stream model → collect tool calls → execute tools → repeat.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → provider.stream() → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → tool.execute() → [afterToolExecution]
  → [afterLoopIteration]
  → repeat or [afterLoopComplete]
```

Middleware hooks intercept every step. Context compaction is itself a `beforeModelCall` middleware.

## Key Types (src/providers/types.ts)

- `IProvider` — `name` + `chat()` + `stream()`. Every provider implements this.
- `IMessage` — `{ role, content, toolCalls?, toolCallId?, isError? }`. Unified across providers.
- `ITool` — `{ name, description, inputSchema, execute() }`. All tools follow this.
- `StreamChunk` — Discriminated union: `text | thinking | tool_call_start | tool_call_delta | tool_call_end | done`.
- `ChatRequest` — `{ model, messages, tools?, thinking?, providerOptions? }`.

## Key Patterns

- **Factory functions for tools**: each tool file exports a function returning `ITool`
- **Provider adapters**: each provider maps `IMessage`/`ITool` to SDK-specific formats via `mapMessages()`, `mapTools()`, `buildParams()`
- **Config merging**: `defaults.ts` → `ra.config.{yml,json,toml}` → `RA_*` env vars → `--cli-flags`
- **Middleware as arrays**: config defines `middleware: { hookName: ["./path.ts"] }`, loaded at startup
- **Skills as directories**: `SKILL.md` with YAML frontmatter, optional `scripts/` and `references/` subdirs

## Development Rules

- Use Bun everywhere — never Node.js, npm, npx, jest, vitest, vite, express, or dotenv
- `bun tsc` must pass before committing — don't use `as any` to silence errors
- Tests go in `tests/` mirroring `src/` structure
- Cast tool input narrowly: `input as { param: string }` not `input as any`
- Use optional spread for conditional fields: `...(x && { key: x })`
- Every `stream()` must yield a `{ type: 'done' }` chunk at the end
- Tool call IDs must be preserved exactly — they match results back to calls
- Prefer `Bun.file` over `node:fs`, `Bun.$` over `execa`, `bun:sqlite` over `better-sqlite3`

## Testing

```ts
import { test, expect } from "bun:test"

test("description", () => {
  expect(result).toBe(expected)
})
```

- Provider tests mock the SDK client
- Loop tests use a `mockProvider()` that yields `StreamChunk[][]`
- Integration tests in `tests/integration/` test full end-to-end flows
