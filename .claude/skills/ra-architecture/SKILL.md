---
name: ra-architecture
description: Use when starting work on the ra codebase, navigating the source, or understanding how components connect.
---

# ra Architecture

ra is an agentic loop you configure into any agent. One binary, multiple interfaces, provider-portable.

## Core Loop

`src/agent/loop.ts` — The heart of ra. Runs: stream model response → collect tool calls → execute tools → repeat until no tool calls or max iterations.

```
User message → [beforeLoopBegin]
  → [beforeModelCall] → provider.stream() → [onStreamChunk]* → [afterModelResponse]
  → [beforeToolExecution] → tool.execute() → [afterToolExecution]
  → [afterLoopIteration]
  → repeat or [afterLoopComplete]
```

## Directory Map

| Directory | Purpose | Key files |
|-----------|---------|-----------|
| `src/agent/` | Agent loop, middleware chain, tool registry, context compaction | `loop.ts`, `middleware.ts`, `tool-registry.ts` |
| `src/providers/` | LLM provider adapters (Anthropic, OpenAI, Google, Ollama, Bedrock, Azure) | Each implements `IProvider` from `types.ts` |
| `src/tools/` | Built-in tools (14 total). Each exports a factory function returning `ITool` | `index.ts` registers all tools |
| `src/interfaces/` | Entry points: CLI, REPL, HTTP, MCP server | Each reads config and wires up the loop |
| `src/config/` | Layered config: defaults → file → env → CLI flags | `types.ts` for `RaConfig`, `index.ts` for loading |
| `src/skills/` | Skill loading, script execution, GitHub install | `loader.ts`, `runner.ts`, `install.ts` |
| `src/mcp/` | MCP client (connect to external servers) and MCP server (expose ra as tool) | `client.ts`, `server.ts` |
| `src/middleware/` | Middleware file loader | `loader.ts` |
| `src/storage/` | JSONL session persistence | `sessions.ts` |

## Key Types (`src/providers/types.ts`)

- `IProvider` — `chat()` + `stream()`. Every provider implements this.
- `IMessage` — Unified message format across providers.
- `ITool` — `name` + `description` + `inputSchema` + `execute()`.
- `StreamChunk` — Discriminated union: `text | thinking | tool_call_start | tool_call_delta | tool_call_end | done`.
- `ChatRequest` — What gets sent to the provider: model, messages, tools, thinking level.

## Extension Points

- **New provider** → implement `IProvider`, add to `src/providers/registry.ts` (see `add-provider` skill)
- **New tool** → factory function returning `ITool`, register in `src/tools/index.ts` (see `add-tool` skill)
- **New middleware** → hook into any of 9 lifecycle points (see `add-middleware` skill)
- **New interface** → read config, build loop, wire I/O (see `src/interfaces/cli.ts` as template)
- **New skill** → `SKILL.md` with frontmatter + markdown body in a `skills/` directory

## Config Flow

```
defaults.ts → ra.config.{yml,json,toml} → RA_* env vars → --cli-flags
```

Each layer overrides the previous. `src/config/index.ts` merges them. `src/config/types.ts` defines `RaConfig`.

## Testing

- `bun test` runs all tests
- Tests live in `tests/` mirroring `src/` structure
- Provider tests mock the SDK client
- Loop tests use `mockProvider()` that yields `StreamChunk[][]`
- Integration tests in `tests/integration/` test full flows

## Commands

- `bun run ra` — run from source
- `bun run compile` — produce `dist/ra` binary
- `bun tsc` — type check
- `bun test` — run tests
