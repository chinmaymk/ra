`@chinmaymk/ra` — the published core library. Must remain runtime-agnostic (Node.js, Bun, Deno).

**Public API:** `index.ts` re-exports everything consumers need. This is the npm package entry point.

**Module Layout:**
```
agent/         # Loop, middleware, tool registry, compaction, token estimation
providers/     # LLM adapters (anthropic, openai, google, ollama, bedrock, azure)
observability/ # Logger interface
utils/         # Error handling, retry logic
index.ts       # Barrel re-exports — the public API surface
```

**Runtime Compatibility Rules:**
- No `Bun.*`, `bun:*`, or `Deno.*` imports — ever
- Use `node:` prefixed imports for Node.js built-ins (e.g., `import { randomUUID } from 'node:crypto'`)
- Stick to standard ECMAScript and universally supported Node.js APIs

**Conventions:**
- Named exports only (no default exports)
- Types live alongside their module: `providers/types.ts`, `agent/types.ts`
- `types.ts` files contain only type definitions, no logic
- No circular imports — dependency flows: `utils → observability → providers → agent → index`
