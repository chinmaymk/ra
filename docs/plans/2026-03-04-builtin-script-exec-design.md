# Built-in JS/TS Script Execution

## Problem

ra ships as a compiled Bun binary. When users don't have `bun`, `node`, or `deno` on PATH, JS/TS skill scripts fail with "None of [bun, node, deno] found on PATH". Since ra already contains the Bun runtime, we should use it to execute scripts without external dependencies.

## Design

### Hidden `--exec` subcommand

Add a `--exec <script-path>` flag to ra's CLI. When invoked:

1. Dynamically `import()` the script file (Bun compiled binaries support this)
2. If the module exports a `default` function, call it and write the return value to stdout
3. If no default export, the module's top-level side effects (including `console.log`) produce the output
4. Exit with code 0 on success, 1 on error (stderr gets the error message)

### Skill runner fallback

In `resolveCmd()`, when `findRuntime(['bun', 'node', 'deno'])` throws for `.ts`/`.js` files, fall back to:

```ts
[process.execPath, '--exec', scriptPath]
```

This spawns a new ra process in exec mode — subprocess isolation preserved.

### Changes

| File | Change |
|------|--------|
| `src/interfaces/parse-args.ts` | Add `--exec` option to meta |
| `src/index.ts` | Handle `--exec` before `main()` — import and run the script, then exit |
| `src/skills/runner.ts` | Catch `findRuntime` failure for `.ts`/`.js`, fall back to `process.execPath --exec` |
| `tests/skills/runner.test.ts` | Test the fallback path |

### Script contract

- Scripts can `console.log()` to produce output (captured via subprocess stdout)
- Scripts can `export default function()` — return value is JSON-stringified to stdout
- Scripts receive environment variables via the subprocess env
- Non-zero exit = error, stderr = error message
