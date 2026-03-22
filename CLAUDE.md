# ra

The predictable, observable agent harness.

## Quick Reference

```bash
bun run ra              # run from source
bun run compile         # build binary → dist/ra
bun tsc                 # type check (must pass, zero errors)
bun test                # run all tests
cd docs/site && bun install && bun run build  # build docs
```

## Project Structure

Each subfolder has its own `CLAUDE.md` with patterns and conventions.

```
packages/
  ra/              # @chinmaymk/ra — core library (published, runtime-agnostic)
  app/             # ra-app — CLI binary (Bun only, not published)
recipes/           # Complete agent configurations
docs/              # VitePress documentation site
```

## Architecture

Core loop (`packages/ra/src/agent/loop.ts`): stream model → collect tool calls → execute tools → repeat.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → provider.stream() → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → tool.execute() → [afterToolExecution]
  → [afterLoopIteration]
  → repeat or [afterLoopComplete]
```

## Runtime Split

- `packages/ra/` — **runtime-agnostic**: no `Bun.*`, `bun:*`, or `Deno.*`. Use `node:` prefixed imports.
- `packages/app/` — **Bun only**: prefer `Bun.file`, `Bun.$`, `bun:sqlite`.

## Rules

- Bun for all tooling — never npm/npx/jest/vitest
- `bun tsc` must pass — no `as any`
- Narrow casts: `input as { param: string }` not `input as any`
- Every `stream()` must yield `{ type: 'done' }` at the end
- Preserve tool call IDs exactly
- Structured logging only: `logger.info('event', { key: value })` — no interpolation
- Ensure code is concise, easy to follow and extremely readable
- Always run `bun tsc` and `bun test` to ensure everything passes
