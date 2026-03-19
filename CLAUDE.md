# ra

ra is an agentic loop framework. One binary, multiple interfaces (CLI/REPL/HTTP/MCP), provider-portable across multiple LLM backends. Deployed as a single self-contained binary compiled via `bun build --compile` — no runtime dependencies needed.

## Quick Reference

```bash
bun run ra              # run from source
bun run compile         # build binary → dist/ra
bun tsc                 # type check (must pass, zero errors)
bun test                # run all tests
bun test packages/ra/tests/agent/   # run tests in a directory
cd docs/site && bun install && bun run build  # build docs (vitepress)
```

## Project Structure

```
packages/
  ra/                # @chinmaymk/ra — core library (published)
    src/
      agent/         # Core loop, middleware chain, tool registry, context compaction
      providers/     # LLM adapters: anthropic, openai, google, ollama, bedrock, azure
      observability/ # Logger
      utils/         # Shared utilities
    tests/           # Tests colocated with core library code
      agent/         # Agent loop, compaction, middleware, tool registry tests
      providers/     # Provider adapter tests
  app/               # ra-app — CLI binary (not published)
    src/
      tools/         # Built-in tools (filesystem, shell, network, agent interaction)
      config/        # Layered config: CLI flags > env > file
      interfaces/    # Entry points: cli, repl, http, mcp
      skills/        # Skill loader, runner, installer
      middleware/    # Middleware file loader
      context/       # Context file discovery and pattern resolution
      mcp/           # MCP client + server
      memory/        # SQLite-backed persistent memory
      storage/       # JSONL session persistence
      utils/         # Shared utilities
    tests/           # App-specific tests
skills/              # Built-in skills (code-review, architect, planner, debugger, code-style, writer)
recipes/             # Complete agent configurations (coding-agent, code-review-agent)
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
- **Config merging**: `--cli-flags` > `RA_*` env vars > `ra.config.{yml,json,toml}`
- **Middleware as arrays**: config defines `middleware: { hookName: ["./path.ts"] }`, loaded at startup
- **Skills as directories**: `SKILL.md` with YAML frontmatter, optional `scripts/` and `references/` subdirs

## Runtime Compatibility

The `packages/ra` core library (`@chinmaymk/ra`) must remain compatible with Node.js, Bun, and Deno. This means:

- **No Bun-specific APIs** in `packages/ra/src/` — no `Bun.file`, `Bun.$`, `Bun.sleep`, `bun:sqlite`, `bun:test`, or any other `Bun.*` / `bun:*` imports
- **No Deno-specific APIs** in `packages/ra/src/` — no `Deno.*` globals
- **Use `node:` prefixed imports** for Node.js built-ins (e.g. `import { randomUUID } from 'node:crypto'`) — the `node:` prefix is supported by Node.js 16+, Bun, and Deno
- **Stick to standard ECMAScript and universally supported Node.js APIs** (crypto, streams, etc.)
- Bun-specific APIs (`Bun.file`, `Bun.$`, `bun:sqlite`, etc.) are fine in `packages/app/` which is the CLI binary and only runs on Bun

## Development Rules

- Use Bun for development tooling (running, testing, building) — never npm, npx, jest, vitest, vite, express, or dotenv
- `bun tsc` must pass before committing — don't use `as any` to silence errors
- Tests colocated with their package: `packages/ra/tests/` for core, `packages/app/tests/` for app
- Cast tool input narrowly: `input as { param: string }` not `input as any`
- Use optional spread for conditional fields: `...(x && { key: x })`
- Every `stream()` must yield a `{ type: 'done' }` chunk at the end
- Tool call IDs must be preserved exactly — they match results back to calls
- In `packages/app/`: prefer `Bun.file` over `node:fs`, `Bun.$` over `execa`, `bun:sqlite` over `better-sqlite3`
- In `packages/ra/`: use only runtime-agnostic APIs (see Runtime Compatibility above)
- Always use structured logging — pass a static message string and a data object: `logger.info('event name', { key: value })`. Never use string interpolation in log messages: `logger.info(\`thing ${x}\`)` is wrong

## Testing

```ts
import { test, expect } from "bun:test"

test("description", () => {
  expect(result).toBe(expected)
})
```

- Provider tests mock the SDK client (`packages/ra/tests/providers/`)
- Loop tests use a `mockProvider()` that yields `StreamChunk[][]` (`packages/ra/tests/agent/`)
- Integration tests in `packages/app/tests/integration/` test full end-to-end flows
