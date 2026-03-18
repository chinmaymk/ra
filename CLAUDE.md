# ra

ra is an agentic loop framework. One binary, multiple interfaces (CLI/REPL/HTTP/MCP), provider-portable across 6 LLM backends. Works as an npm package on any Node.js runtime, or compiled to a single self-contained binary via `bun build --compile`.

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
  tools/       # 14 built-in tools (filesystem, shell, network, agent interaction)
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
skills/        # 6 built-in skills (code-review, architect, planner, debugger, code-style, writer)
recipes/       # 2 complete agent configurations (coding-agent, code-review-agent)
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

9 middleware hooks intercept every step. Context compaction is itself a `beforeModelCall` middleware.

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

- Use general-purpose Node.js APIs — code must work on both Bun and Node.js runtimes
- **Never use Bun-specific APIs** (`Bun.file`, `Bun.write`, `Bun.serve`, `Bun.spawn`, `Bun.Glob`, `Bun.$`, `Bun.which`) — use their cross-platform equivalents instead:
  - File I/O: `node:fs/promises` (`readFile`, `writeFile`, `access`) or helpers in `src/utils/fs.ts`
  - Glob: `fast-glob`
  - Shell/spawn: `node:child_process` (`spawn`, `spawnSync`)
  - HTTP server: `node:http` (`createServer`)
  - SQLite: conditional import — `bun:sqlite` when running under Bun, `node:sqlite` (`DatabaseSync`) otherwise
  - Transpiler: conditional — `Bun.Transpiler` if available, else `esbuild`, else plain `eval`
- `bun tsc` must pass before committing — don't use `as any` to silence errors
- Tests go in `tests/` mirroring `src/` structure
- Cast tool input narrowly: `input as { param: string }` not `input as any`
- Use optional spread for conditional fields: `...(x && { key: x })`
- Every `stream()` must yield a `{ type: 'done' }` chunk at the end
- Tool call IDs must be preserved exactly — they match results back to calls

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
- Node.js compatibility tests in `tests/node/` run via `vitest` to verify cross-runtime behavior
