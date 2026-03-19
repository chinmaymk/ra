# ra

ra is an agentic loop framework. One binary, multiple interfaces (CLI/REPL/HTTP/MCP), provider-portable across multiple LLM backends. Deployed as a single self-contained binary compiled via `bun build --compile`.

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

Each subfolder has its own `CLAUDE.md` with detailed patterns and conventions.

```
packages/
  ra/                # @chinmaymk/ra — core library (published, runtime-agnostic)
    src/
      agent/         # Core loop, middleware chain, tool registry, context compaction
      providers/     # LLM adapters: anthropic, openai, google, ollama, bedrock, azure
      observability/ # Logger interface
      utils/         # Error handling, retry logic
    tests/           # Core library tests
  app/               # ra-app — CLI binary (Bun only, not published)
    src/
      tools/         # Built-in tools (filesystem, shell, network, agent interaction)
      config/        # Layered config: CLI flags > env > file
      interfaces/    # Entry points: cli, repl, http, mcp
      skills/        # Skill loader, runner, installer
      middleware/    # Middleware file loader
      context/       # Context file discovery
      mcp/           # MCP client + server
      memory/        # SQLite-backed persistent memory
      storage/       # JSONL session persistence
    tests/           # App-specific tests
recipes/             # Complete agent configurations (coding-agent, code-review-agent)
docs/                # VitePress documentation site
```

## Architecture

The core loop (`packages/ra/src/agent/loop.ts`) runs: stream model → collect tool calls → execute tools → repeat.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → provider.stream() → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → tool.execute() → [afterToolExecution]
  → [afterLoopIteration]
  → repeat or [afterLoopComplete]
```

Middleware hooks intercept every step. Context compaction is itself a `beforeModelCall` middleware.

## Runtime Compatibility

- `packages/ra/` — **runtime-agnostic**: no `Bun.*`, `bun:*`, or `Deno.*` APIs. Use `node:` prefixed imports only.
- `packages/app/` — **Bun only**: prefer `Bun.file`, `Bun.$`, `bun:sqlite`.

## Development Rules

- Use Bun for all tooling — never npm, npx, jest, vitest, vite, express, or dotenv
- `bun tsc` must pass before committing — don't use `as any` to silence errors
- Cast tool input narrowly: `input as { param: string }` not `input as any`
- Use optional spread for conditional fields: `...(x && { key: x })`
- Every `stream()` must yield a `{ type: 'done' }` chunk at the end
- Tool call IDs must be preserved exactly
- Always use structured logging: `logger.info('event name', { key: value })` — never string interpolation

## Testing

```ts
import { test, expect } from "bun:test"
```

- Provider tests mock the SDK client
- Loop tests use `mockProvider()` that yields `StreamChunk[][]`
- Integration tests in `packages/app/tests/integration/`
- See `packages/ra/tests/CLAUDE.md` for test helpers and patterns
