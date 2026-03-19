`ra-app` — the CLI binary. Not published to npm. Runs on Bun only.

**Entry Point:** `src/index.ts` parses CLI args, loads config, routes to the selected interface.

**Module Dependency Flow:**
```
index.ts → config/ → providers → agent/tool-registry → tools/ → skills/ → middleware/ → agent/loop → interfaces/
```

**Bun-Specific APIs Are OK Here:**
- Prefer `Bun.file` over `node:fs`, `Bun.$` over `execa`, `bun:sqlite` over `better-sqlite3`
- This package is compiled via `bun build --compile` into a single binary

**Subfolder Guides:**
Each `src/` subdirectory has its own `CLAUDE.md` with detailed patterns:
- `tools/` — Built-in tool implementations (factory pattern)
- `config/` — Layered config system
- `interfaces/` — CLI, REPL, HTTP, MCP entry points
- `skills/` — Skill loading and execution
- `middleware/` — Middleware file loading
- `context/` — Context file discovery
- `mcp/` — MCP client and server
- `memory/` — SQLite-backed persistent memory
- `storage/` — JSONL session persistence

**Conventions:**
- Named exports, no default exports (except middleware files which use default export)
- Types colocated with their module
- No circular imports
