# Thinking Tokens Design

**Date:** 2026-03-03
**Status:** Approved

## Overview

Expose extended thinking / reasoning effort configuration in ra, with first-class type support across providers and dimmed REPL rendering for thinking content.

## Goals

- Single global `--thinking low|medium|high` flag (+ `RA_THINKING` env var)
- Support Anthropic, Bedrock (Claude), Google (Gemini), and OpenAI (o-series) natively
- Stream thinking content in REPL with dim ANSI styling; skip in CLI/HTTP/MCP modes
- Surface thinking token counts in `TokenUsage`

## Type Changes (`src/providers/types.ts`)

```ts
export interface ChatRequest {
  model: string
  messages: IMessage[]
  tools?: ITool[]
  thinking?: 'low' | 'medium' | 'high'   // new
  providerOptions?: Record<string, unknown>
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }   // new
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'done'; usage?: TokenUsage }

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  thinkingTokens?: number                 // new, best-effort
}
```

## Provider Implementations

### Anthropic

Maps `thinking` to `thinking: { type: 'enabled', budget_tokens: N }`.

Budget mapping:
- `low` → 1,000 tokens
- `medium` → 8,000 tokens
- `high` → 32,000 tokens

Streaming: `thinking` content blocks (`content_block_start` with type `thinking`, `content_block_delta` with type `thinking_delta`) emit `{ type: 'thinking', delta }` chunks. `thinkingTokens` is extracted from usage if the API exposes it.

### Bedrock (Claude models)

Same budget mapping as Anthropic. Thinking param passed via `additionalModelRequestFields: { thinking: { type: 'enabled', budget_tokens: N } }`.

### Google (Gemini thinking models)

Maps `thinking` to `generationConfig: { thinkingConfig: { thinkingBudget: N } }`.

Budget mapping (Gemini uses smaller budgets):
- `low` → 512 tokens
- `medium` → 4,096 tokens
- `high` → 16,384 tokens

Thinking content comes back as parts with `thought: true`; these emit `thinking_delta` stream chunks.

### OpenAI (o-series models)

Maps `thinking` directly to `reasoning: { effort: 'low' | 'medium' | 'high' }` — values align 1:1. Thinking is internal (not streamed), so no `thinking_delta` chunks are emitted. `thinkingTokens` sourced from `usage.completion_tokens_details.reasoning_tokens`.

Non-reasoning OpenAI models ignore the param.

### Ollama

Silently ignored.

## Config & CLI

`RaConfig` addition:
```ts
thinking?: 'low' | 'medium' | 'high'
```

CLI flag: `--thinking <level>`
Env var: `RA_THINKING`

The agent loop passes `config.thinking` into every `ChatRequest`. Default is `undefined` (disabled).

Help text:
```
THINKING
  --thinking <level>    Enable extended thinking: low | medium | high

ENV VARS
  RA_THINKING
```

## REPL Rendering

`thinking_delta` chunks are buffered and rendered with ANSI dim styling, wrapped in a visual block that appears before the main response:

```
╌╌ thinking ╌╌
[dimmed thinking content]
╌╌╌╌╌╌╌╌╌╌╌╌╌╌
```

The block closes automatically when the first `text` chunk arrives. Other modes (CLI, HTTP, MCP) skip `thinking` chunks entirely and only surface `thinkingTokens` in usage metadata.
