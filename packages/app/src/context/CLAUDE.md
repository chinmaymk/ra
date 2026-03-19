# src/context/

Context file discovery and pattern resolution. Automatically finds and injects relevant context (like CLAUDE.md files) into the agent's messages.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Public API: `discoverContextFiles()`, `buildContextMessages()`, `resolvePatterns()`, `createResolverMiddleware()` |
| `types.ts` | `ContextConfig`, `ContextFile`, `ResolverConfig` interfaces |

## Context Discovery

`discoverContextFiles()` walks from the current directory up to the git root, collecting files that match configured patterns (e.g., `CLAUDE.md`, `AGENTS.md`).

## Pattern Resolution

Two built-in resolvers:
- **file** — `@file:path` references in context files are replaced with the file's contents
- **url** — `url:https://...` references are fetched and injected

## Integration

Context is injected as user messages at the start of the conversation, before the agent loop begins. The `createResolverMiddleware()` can also be used as a `beforeModelCall` middleware.
