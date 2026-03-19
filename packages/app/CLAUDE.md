`ra-app` — CLI binary. Bun only, not published.

Entry point: `src/index.ts` → parse args → load config → route to interface.

Bun APIs encouraged here: `Bun.file`, `Bun.$`, `bun:sqlite`.

Each `src/` subdirectory has its own `CLAUDE.md`. Named exports, no default exports (except middleware files).
