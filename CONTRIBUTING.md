# Contributing to ra

## Setup

```bash
bun install
bun test          # run tests
bun tsc           # type check
```

## Development

```bash
bun run src/index.ts "hello"              # run in dev mode
bun run src/index.ts --repl               # interactive REPL
bun run compile                           # build binary → dist/ra
```

## Project structure

```
src/
  agent/          # core agent loop, context compaction, middleware
  config/         # config loading and types
  context/        # context discovery and pattern resolution
  interfaces/     # CLI, REPL, HTTP, TUI helpers
  mcp/            # MCP client and server
  middleware/     # middleware loading
  providers/      # LLM providers (anthropic, openai, google, ollama, bedrock, azure)
  skills/         # skill loading, registry, runner
  storage/        # session persistence (JSONL)
  tools/          # built-in tools (filesystem, shell, network)
  utils/          # file utilities, MIME detection
tests/            # mirrors src/ structure
skills/           # built-in skills
recipes/          # pre-built agent configurations
docs/             # documentation site
```

## Running tests

```bash
bun test                          # all tests
bun test tests/agent              # specific directory
bun test tests/agent/loop.test.ts # specific file
```

## Adding a provider

1. Create `src/providers/<name>.ts` implementing `IProvider`
2. Add to `src/providers/registry.ts`
3. Add config type to `src/config/types.ts`
4. Add env var mapping to `src/config/index.ts`
5. Add tests in `tests/providers/<name>.test.ts`

## Adding a tool

1. Create `src/tools/<name>.ts` exporting a function that returns `ITool`
2. Register in `src/tools/index.ts`
3. Add tests in `tests/tools/<name>.test.ts`

## Submitting changes

- Write tests for new features
- All tests must pass (`bun test`)
- No TypeScript errors (`bun tsc`)
- Keep commits focused and descriptive
