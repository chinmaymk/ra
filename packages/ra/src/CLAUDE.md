`@chinmaymk/ra` — published core library. Runtime-agnostic (Node.js, Bun, Deno).

`index.ts` is the public API surface — barrel re-exports from all submodules.

**Rules:**
- No `Bun.*`, `bun:*`, or `Deno.*` imports
- Use `node:` prefixed imports for built-ins
- Named exports only, no default exports
- Types in `types.ts` files — no logic in type files
- No circular imports. Flow: `utils → observability → providers → agent → index`
