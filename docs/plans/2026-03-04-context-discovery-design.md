# Context Discovery Design

## Summary

Add automatic discovery and injection of project context files (CLAUDE.md, AGENTS.md, .cursorrules, etc.) so ra can pick up project-specific instructions without manual configuration.

## Design

### New module: `src/context/`

Three files:

- **`types.ts`** — `ContextFile` type (path, relativePath, content), config shape
- **`discovery.ts`** — Walks from cwd up to git root, matches file patterns, reads matched files, returns `ContextFile[]`
- **`inject.ts`** — Wraps each `ContextFile` in a `<context-file path="...">` XML tag and returns user messages (one per file)

### Config

```yaml
context:
  enabled: true        # false to disable entirely (default: true)
  patterns:            # list of file globs to look for
    - CLAUDE.md
    - AGENTS.md
    - .cursorrules
    - .cursor/rules/*
    - .github/copilot-instructions.md
    - .windsurfrules
    - .clinerules
```

- `patterns` is a flat list of file glob strings
- No patterns = no discovery

### Discovery

- Walk from cwd up to git root (via `git rev-parse --show-toplevel`, fall back to filesystem root)
- At each directory, check for files matching each pattern
- Return all matched files as `ContextFile[]` (closest directory first)

### Injection

Each discovered file becomes a separate user message prepended before the actual user message:

```
Message 1 (user): <context-file path="CLAUDE.md">...content...</context-file>
Message 2 (user): <context-file path=".cursorrules">...content...</context-file>
Message 3 (user): the actual user prompt
```

### Inspection

- **`--show-context` CLI flag** — runs discovery, prints file list with paths and sizes, shows content, then exits
- **`/context` REPL command** — same output during an interactive session

### Integration points

1. **`src/index.ts`** — Run discovery early, before building messages
2. **`src/interfaces/cli.ts`** — Prepend context messages before user message
3. **`src/interfaces/repl.ts`** — Same injection + `/context` command handler
4. **`src/config/types.ts`** — Add `context` field to `RaConfig`

### What this does NOT do

- No format-specific parsing (no .mdc frontmatter, no AGENTS.md path scoping)
- No smart filtering or scoping logic
- If you don't want a file, remove the pattern from config
