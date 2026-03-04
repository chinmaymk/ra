# Skill Script Runtime Support

## Overview

Extend `runner.ts` to support `.py`, `.go`, `.sh`, `.js`, and `.ts` scripts with multi-runtime JS/TS dispatch. Shebang lines take priority; extension-based defaults use runtime probing as fallback. No changes to skill types, loader, or config.

## Dispatch Logic

Two-step resolution in `runSkillScript`:

1. **Shebang detection** — read first line; if `#!`, extract binary name (e.g. `#!/usr/bin/env node` → `node`) and use it directly.
2. **Extension-based defaults** — if no shebang:
   - `.sh` → `sh`
   - `.py` → first of `python3`, `python` found via `Bun.which()`
   - `.go` → `go run`
   - `.js`, `.ts` → first of `node`, `bun`, `deno` found via `Bun.which()`

## Runtime Probing

A helper `findRuntime(candidates: string[]): Promise<string>` checks each candidate via `Bun.which()` and returns the first found. Throws a clear error if none are available.

```ts
async function findRuntime(candidates: string[]): Promise<string> {
  for (const c of candidates) {
    if (Bun.which(c)) return c
  }
  throw new Error(`None of [${candidates.join(', ')}] found on PATH`)
}
```

## Command Construction

| Extension | Shebang absent — default command |
|-----------|----------------------------------|
| `.sh`     | `sh <path>` |
| `.py`     | `python3 <path>` (or `python`) |
| `.go`     | `go run <path>` |
| `.js`     | `node <path>` (or `bun`, `deno`) |
| `.ts`     | `node <path>` (or `bun`, `deno`) |

When shebang is present: `<binary> <path>` (e.g. `deno run <path>` for deno, `node <path>` for node).

## Error Handling

- Non-zero exit: throw with stderr (existing behavior, unchanged).
- Runtime not found: throw `None of [...] found on PATH`.
- Unknown extension: throw `Unsupported script extension: .<ext>`.

## Files Changed

- `src/skills/runner.ts` — all logic changes here
- `tests/skills/runner.test.ts` — extended with new test cases

## Tests

### CI-safe test strategy

All tests that require an optional runtime (python, go, deno, node) must guard with `Bun.which()` and call `test.skip` if the runtime is absent. Only `bun` and `sh` are assumed to be universally available in CI.

```ts
const hasPython = !!Bun.which('python3') || !!Bun.which('python')
const hasGo     = !!Bun.which('go')
const hasDeno   = !!Bun.which('deno')
const hasNode   = !!Bun.which('node')
```

### Per-language smoke tests
One test per extension: write a script printing a known string, assert captured output.
- `.sh` — always runs (sh is universal)
- `.ts` via bun — always runs (bun runs the test suite)
- `.js` via bun shebang — always runs
- `.py` — skipped if python3/python absent
- `.go` — skipped if go absent
- `.js` via node shebang — skipped if node absent
- `.ts` via deno shebang — skipped if deno absent

### Shebang override
Write a `.js` file with `#!/usr/bin/env bun`, verify it runs under bun (detect via `process.versions.bun` in output). Always runs.

### Runtime fallback
Mock `Bun.which` to return `null` for `node`, verify `bun` is selected next. Mock both `node` and `bun` absent, verify `deno` is selected. Uses mocking — no real runtimes needed, always runs.

## Non-Goals

- No config-level runtime overrides (YAGNI).
- No changes to `Skill`, `SkillMetadata`, `loader.ts`, or any config types.
- No passing of extra flags to runtimes beyond the script path.
