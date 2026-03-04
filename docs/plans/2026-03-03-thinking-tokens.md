# Thinking Tokens Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add first-class `thinking` support across all providers with REPL dim rendering and CLI/env config.

**Architecture:** Add `thinking?: 'low'|'medium'|'high'` to `ChatRequest` and `RaConfig`. Each provider maps this to its native representation. `StreamChunk` gains a `thinking` variant; REPL renders it dimmed, other modes skip it. `TokenUsage.thinkingTokens` surfaces count where available.

**Tech Stack:** Bun, TypeScript, `@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`, `@google/generative-ai`, `openai`

---

### Task 1: Core type changes

**Files:**
- Modify: `src/providers/types.ts`
- Test: `tests/providers/types.test.ts`

**Step 1: Write the failing test**

In `tests/providers/types.test.ts`, add:

```ts
import { describe, it, expectTypeOf } from 'bun:test'
import type { ChatRequest, StreamChunk, TokenUsage } from '../../src/providers/types'

describe('types', () => {
  it('ChatRequest has thinking field', () => {
    const req: ChatRequest = {
      model: 'x',
      messages: [],
      thinking: 'medium',
    }
    expectTypeOf(req.thinking).toEqualTypeOf<'low' | 'medium' | 'high' | undefined>()
  })

  it('StreamChunk accepts thinking variant', () => {
    const chunk: StreamChunk = { type: 'thinking', delta: 'hmm...' }
    expectTypeOf(chunk).toMatchTypeOf<StreamChunk>()
  })

  it('TokenUsage has thinkingTokens', () => {
    const u: TokenUsage = { inputTokens: 10, outputTokens: 5, thinkingTokens: 200 }
    expectTypeOf(u.thinkingTokens).toEqualTypeOf<number | undefined>()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/providers/types.test.ts
```
Expected: FAIL (type errors or missing fields)

**Step 3: Update `src/providers/types.ts`**

Add `thinking` to `ChatRequest`:
```ts
export interface ChatRequest {
  model: string
  messages: IMessage[]
  tools?: ITool[]
  thinking?: 'low' | 'medium' | 'high'
  providerOptions?: Record<string, unknown>
}
```

Add `thinking` variant to `StreamChunk`:
```ts
export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'done'; usage?: TokenUsage }
```

Add `thinkingTokens` to `TokenUsage`:
```ts
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  thinkingTokens?: number
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/providers/types.test.ts
```
Expected: PASS

**Step 5: TypeScript check + commit**

```bash
bun tsc --noEmit
git add src/providers/types.ts tests/providers/types.test.ts
git commit -m "feat: add thinking to ChatRequest, StreamChunk, TokenUsage types"
```

---

### Task 2: Config layer

**Files:**
- Modify: `src/config/types.ts`
- Modify: `src/config/defaults.ts`
- Modify: `src/config/index.ts`
- Test: `tests/config/index.test.ts`

**Step 1: Write the failing test**

In `tests/config/index.test.ts`, add a describe block:

```ts
describe('thinking config', () => {
  it('loads RA_THINKING from env', async () => {
    const config = await loadConfig({ env: { RA_THINKING: 'medium' } })
    expect(config.thinking).toBe('medium')
  })

  it('defaults thinking to undefined', async () => {
    const config = await loadConfig({ env: {} })
    expect(config.thinking).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/config/index.test.ts
```
Expected: FAIL (`config.thinking` does not exist)

**Step 3: Update `src/config/types.ts`**

Add to `RaConfig`:
```ts
export interface RaConfig {
  // ... existing fields ...
  thinking?: 'low' | 'medium' | 'high'
}
```

**Step 4: Update `src/config/defaults.ts`**

No change needed — `thinking` is optional so absence = undefined. (Do NOT add it to defaultConfig.)

**Step 5: Update `src/config/index.ts`** — add to `loadEnvVars`:

```ts
if (env.RA_THINKING !== undefined) set(['thinking'], env.RA_THINKING)
```

Add after the existing top-level env vars block (around line 79).

**Step 6: Run test to verify it passes**

```bash
bun test tests/config/index.test.ts
```
Expected: PASS

**Step 7: Commit**

```bash
git add src/config/types.ts src/config/index.ts tests/config/index.test.ts
git commit -m "feat: add thinking to RaConfig with RA_THINKING env var"
```

---

### Task 3: CLI flag and help text

**Files:**
- Modify: `src/interfaces/parse-args.ts`
- Modify: `src/index.ts`
- Test: `tests/config/parse-args.test.ts`

**Step 1: Write the failing test**

In `tests/config/parse-args.test.ts`, add:

```ts
it('parses --thinking flag', () => {
  const result = parseArgs(['node', 'ra.ts', '--thinking', 'high'])
  expect(result.config.thinking).toBe('high')
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/config/parse-args.test.ts
```
Expected: FAIL

**Step 3: Update `src/interfaces/parse-args.ts`**

Add to the `utilParseArgs` options object:
```ts
'thinking': { type: 'string' },
```

Add to the mapping section (after `max-iterations`):
```ts
if (values['thinking']) set(['thinking'], values['thinking'])
```

**Step 4: Update help text in `src/index.ts`**

Add a `THINKING` section after `STORAGE`:
```
THINKING
  --thinking <level>    Enable extended thinking: low | medium | high
```

Add to the `ENV VARS` line:
```
  RA_THINKING
```

**Step 5: Run test to verify it passes**

```bash
bun test tests/config/parse-args.test.ts
```
Expected: PASS

**Step 6: Commit**

```bash
git add src/interfaces/parse-args.ts src/index.ts tests/config/parse-args.test.ts
git commit -m "feat: add --thinking CLI flag and RA_THINKING env var to help text"
```

---

### Task 4: Agent loop + interface threading

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `src/interfaces/repl.ts`
- Modify: `src/interfaces/cli.ts`
- Modify: `src/interfaces/http.ts`
- Modify: `src/index.ts`
- Test: `tests/agent/loop.test.ts`

**Step 1: Write the failing test**

In `tests/agent/loop.test.ts`, find the existing mock provider setup and add:

```ts
it('passes thinking to ChatRequest', async () => {
  const capturedRequests: ChatRequest[] = []
  const mockProvider = {
    name: 'mock',
    stream: async function*(req: ChatRequest) {
      capturedRequests.push(req)
      yield { type: 'done' as const }
    },
    chat: async () => ({ message: { role: 'assistant' as const, content: '' } }),
  }
  const tools = new ToolRegistry()
  const loop = new AgentLoop({ provider: mockProvider, tools, model: 'test', thinking: 'low' })
  await loop.run([{ role: 'user', content: 'hi' }])
  expect(capturedRequests[0]?.thinking).toBe('low')
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/agent/loop.test.ts
```
Expected: FAIL (`AgentLoopOptions` has no `thinking`)

**Step 3: Update `src/agent/loop.ts`**

Add `thinking` to `AgentLoopOptions`:
```ts
export interface AgentLoopOptions {
  provider: IProvider
  tools: ToolRegistry
  maxIterations?: number
  model?: string
  thinking?: 'low' | 'medium' | 'high'
  middleware?: Partial<MiddlewareConfig>
  sessionId?: string
}
```

Add `private thinking` field and store it in constructor:
```ts
private thinking: 'low' | 'medium' | 'high' | undefined

constructor(options: AgentLoopOptions) {
  // ... existing ...
  this.thinking = options.thinking
}
```

In the `run` method, update the request construction (line 62):
```ts
const request = {
  model: this.model,
  messages: [...messages],
  tools: this.tools.all(),
  ...(this.thinking && { thinking: this.thinking }),
}
```

**Step 4: Update `src/interfaces/repl.ts`** — add `thinking` to `ReplOptions` and thread it to `AgentLoop`:

```ts
export interface ReplOptions {
  // ... existing fields ...
  thinking?: 'low' | 'medium' | 'high'
}
```

In `processInput`, add `thinking: this.options.thinking` to the `AgentLoop` constructor call.

**Step 5: Update `src/interfaces/cli.ts`** — read this file first, then add `thinking` to its options type and thread to `AgentLoop`.

**Step 6: Update `src/interfaces/http.ts`** — same pattern: add `thinking` to options, thread to `AgentLoop`.

**Step 7: Update `src/index.ts`** — pass `thinking: config.thinking` in all three interface launch blocks (cli, repl, http).

**Step 8: Run tests**

```bash
bun test tests/agent/loop.test.ts
```
Expected: PASS

**Step 9: Commit**

```bash
git add src/agent/loop.ts src/interfaces/repl.ts src/interfaces/cli.ts src/interfaces/http.ts src/index.ts tests/agent/loop.test.ts
git commit -m "feat: thread thinking option through AgentLoop and all interfaces"
```

---

### Task 5: Anthropic provider thinking

**Files:**
- Modify: `src/providers/anthropic.ts`
- Test: `tests/providers/anthropic.test.ts`

**Budget mapping:** `low=1000`, `medium=8000`, `high=32000`

**Step 1: Write the failing test**

In `tests/providers/anthropic.test.ts`, add:

```ts
describe('thinking', () => {
  it('includes thinking param in buildParams when thinking is set', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const request = {
      model: 'claude-3-7-sonnet-20250219',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'medium' as const,
    }
    const params = (provider as any).buildParams(request)
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })
  })

  it('does not include thinking when not set', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const request = { model: 'claude-3-7-sonnet-20250219', messages: [{ role: 'user' as const, content: 'hi' }] }
    const params = (provider as any).buildParams(request)
    expect(params.thinking).toBeUndefined()
  })

  it('maps low to 1000 tokens', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({ model: 'x', messages: [], thinking: 'low' })
    expect(params.thinking.budget_tokens).toBe(1000)
  })

  it('maps high to 32000 tokens', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({ model: 'x', messages: [], thinking: 'high' })
    expect(params.thinking.budget_tokens).toBe(32000)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/providers/anthropic.test.ts
```
Expected: FAIL

**Step 3: Update `src/providers/anthropic.ts`**

Add a budget helper and update `buildParams`:

```ts
const THINKING_BUDGETS = { low: 1000, medium: 8000, high: 32000 } as const

// In buildParams:
private buildParams(request: ChatRequest) {
  const { system, filtered } = extractSystemMessages(request.messages)
  return {
    model: request.model,
    max_tokens: (request.providerOptions?.maxTokens as number) ?? 4096,
    messages: this.mapMessages(filtered),
    ...(system && { system }),
    ...(request.tools?.length && { tools: this.mapTools(request.tools) }),
    ...(request.thinking && { thinking: { type: 'enabled', budget_tokens: THINKING_BUDGETS[request.thinking] } }),
  }
}
```

Also update `stream` to handle `thinking_delta` events from Anthropic's streaming API:

In the `content_block_delta` case, add:
```ts
else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: event.delta.thinking }
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/providers/anthropic.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/anthropic.ts tests/providers/anthropic.test.ts
git commit -m "feat: add thinking support to AnthropicProvider"
```

---

### Task 6: Bedrock provider thinking

**Files:**
- Modify: `src/providers/bedrock.ts`
- Test: `tests/providers/bedrock.test.ts`

**Step 1: Write the failing test**

In `tests/providers/bedrock.test.ts`, add:

```ts
describe('thinking', () => {
  it('includes additionalModelRequestFields when thinking is set', () => {
    const provider = new BedrockProvider({})
    const params = (provider as any).buildParams({
      model: 'anthropic.claude-3-7-sonnet',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'high',
    })
    expect(params.additionalModelRequestFields).toEqual({
      thinking: { type: 'enabled', budget_tokens: 32000 }
    })
  })

  it('does not include additionalModelRequestFields when thinking is not set', () => {
    const provider = new BedrockProvider({})
    const params = (provider as any).buildParams({ model: 'x', messages: [] })
    expect(params.additionalModelRequestFields).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/providers/bedrock.test.ts
```
Expected: FAIL

**Step 3: Update `src/providers/bedrock.ts`**

Add same budget constant (or import from a shared util — but for now inline):
```ts
const THINKING_BUDGETS = { low: 1000, medium: 8000, high: 32000 } as const
```

Update `buildParams` to add:
```ts
...(request.thinking && {
  additionalModelRequestFields: {
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGETS[request.thinking] }
  }
}),
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/providers/bedrock.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/bedrock.ts tests/providers/bedrock.test.ts
git commit -m "feat: add thinking support to BedrockProvider via additionalModelRequestFields"
```

---

### Task 7: Google provider thinking

**Files:**
- Modify: `src/providers/google.ts`
- Test: `tests/providers/google.test.ts`

**Budget mapping:** `low=512`, `medium=4096`, `high=16384`

Google's `@google/generative-ai` SDK may not have typed `thinkingConfig` yet — use a type assertion (`as any`) on the `generationConfig` object.

**Step 1: Write the failing test**

In `tests/providers/google.test.ts`, add:

```ts
describe('thinking', () => {
  it('builds thinkingConfig in generationConfig for medium', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const genConfig = (provider as any).buildThinkingConfig('medium')
    expect(genConfig).toEqual({ thinkingBudget: 4096 })
  })

  it('returns undefined thinkingConfig when thinking not set', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const genConfig = (provider as any).buildThinkingConfig(undefined)
    expect(genConfig).toBeUndefined()
  })

  it('maps low to 512', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    expect((provider as any).buildThinkingConfig('low')).toEqual({ thinkingBudget: 512 })
  })

  it('maps high to 16384', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    expect((provider as any).buildThinkingConfig('high')).toEqual({ thinkingBudget: 16384 })
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/providers/google.test.ts
```
Expected: FAIL

**Step 3: Update `src/providers/google.ts`**

Add budget constants and a helper method:

```ts
const THINKING_BUDGETS_GOOGLE = { low: 512, medium: 4096, high: 16384 } as const

// In GoogleProvider class:
private buildThinkingConfig(thinking?: 'low' | 'medium' | 'high') {
  if (!thinking) return undefined
  return { thinkingBudget: THINKING_BUDGETS_GOOGLE[thinking] }
}
```

Update `chat` and `stream` to pass `generationConfig` when thinking is set:

```ts
async chat(request: ChatRequest): Promise<ChatResponse> {
  const { model, contents, tools } = this.buildModel(request)
  const thinkingConfig = this.buildThinkingConfig(request.thinking)
  const generationConfig = thinkingConfig ? { thinkingConfig } as any : undefined
  const result = await model.generateContent({
    contents,
    ...(tools && { tools }),
    ...(generationConfig && { generationConfig }),
  })
  // ...
}

async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
  const { model, contents, tools } = this.buildModel(request)
  const thinkingConfig = this.buildThinkingConfig(request.thinking)
  const generationConfig = thinkingConfig ? { thinkingConfig } as any : undefined
  const result = await model.generateContentStream({
    contents,
    ...(tools && { tools }),
    ...(generationConfig && { generationConfig }),
  })
  // ...
  for await (const chunk of result.stream) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if ('thought' in part && part.thought && 'text' in part && part.text) {
        yield { type: 'thinking', delta: part.text }
      } else if ('text' in part && part.text) {
        yield { type: 'text', delta: part.text }
      } else if ('functionCall' in part && part.functionCall) {
        // ... existing tool call handling
      }
    }
    // ...
  }
}
```

**Step 4: Run test to verify it passes**

```bash
bun test tests/providers/google.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/google.ts tests/providers/google.test.ts
git commit -m "feat: add thinking support to GoogleProvider via thinkingConfig"
```

---

### Task 8: OpenAI provider reasoning effort

**Files:**
- Modify: `src/providers/openai.ts`
- Test: `tests/providers/openai.test.ts`

OpenAI maps `thinking` → `reasoning: { effort: level }`. Reasoning tokens are in `usage.completion_tokens_details.reasoning_tokens`.

**Step 1: Write the failing test**

In `tests/providers/openai.test.ts`, add:

```ts
describe('thinking / reasoning effort', () => {
  it('adds reasoning effort to buildParams when thinking is set', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'medium',
    })
    expect(params.reasoning).toEqual({ effort: 'medium' })
  })

  it('does not add reasoning when thinking is not set', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({
      model: 'gpt-4o',
      messages: [{ role: 'user' as const, content: 'hi' }],
    })
    expect(params.reasoning).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

```bash
bun test tests/providers/openai.test.ts
```
Expected: FAIL

**Step 3: Update `src/providers/openai.ts`**

In `buildParams`, add:
```ts
if (request.thinking) (params as any).reasoning = { effort: request.thinking }
```

Update `toUsage` to also extract reasoning tokens. Update the non-streaming usage extraction in `chat`:
```ts
private toUsage(u: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } }): TokenUsage {
  return {
    inputTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
    ...(u.completion_tokens_details?.reasoning_tokens && { thinkingTokens: u.completion_tokens_details.reasoning_tokens }),
  }
}
```

For streaming, update the `done` chunk emission — find where `this.toUsage(chunk.usage)` is called and ensure `chunk.usage` is passed with its full type (the existing code already passes the full usage object, so `toUsage` just needs the updated signature).

**Step 4: Run test to verify it passes**

```bash
bun test tests/providers/openai.test.ts
```
Expected: PASS

**Step 5: Commit**

```bash
git add src/providers/openai.ts tests/providers/openai.test.ts
git commit -m "feat: add reasoning effort support to OpenAIProvider"
```

---

### Task 9: TUI helpers + REPL rendering

**Files:**
- Modify: `src/interfaces/tui.ts`
- Modify: `src/interfaces/repl.ts`
- Test: `tests/interfaces/repl.test.ts`

**Step 1: Add TUI helpers in `src/interfaces/tui.ts`**

No test needed for pure ANSI output functions. Add directly:

```ts
export function printThinkingStart(): void {
  process.stdout.write(`\n  ${c.dim}╌╌ thinking ╌╌${c.reset}\n  ${c.dim}`)
}

export function printThinkingEnd(): void {
  process.stdout.write(`${c.reset}\n  ${c.dim}╌╌╌╌╌╌╌╌╌╌╌╌╌╌${c.reset}\n`)
}
```

**Step 2: Write a failing test for REPL thinking rendering**

In `tests/interfaces/repl.test.ts`, find the existing test setup. Add:

```ts
it('renders thinking chunks before text chunks with dim styling', async () => {
  // Look at existing test patterns in this file to understand mock provider setup.
  // The mock provider should yield: thinking chunk, then text chunk.
  // Assert that stdout output contains the dim escape code before the thinking delta.
  // Use the same mock pattern already used in the file.
})
```

Read `tests/interfaces/repl.test.ts` first to understand the existing mock provider pattern before writing this test.

**Step 3: Update `src/interfaces/repl.ts`** — update the `onStreamChunk` middleware:

```ts
onStreamChunk: [
  async (ctx: StreamChunkContext) => {
    if (ctx.chunk.type === 'thinking') {
      if (!thinkingOpened) {
        tui.stopSpinner(true)
        tui.printThinkingStart()
        thinkingOpened = true
      }
      process.stdout.write(ctx.chunk.delta)
    } else if (ctx.chunk.type === 'text') {
      if (thinkingOpened) {
        tui.printThinkingEnd()
        thinkingOpened = false
      }
      if (!boxOpened) { tui.stopSpinner(); boxOpened = true }
      process.stdout.write(ctx.chunk.delta)
    }
  },
  // ...
],
```

Add `let thinkingOpened = false` alongside the existing `let boxOpened = false`.

Also update the cleanup after `loop.run()` to close thinking block if still open:
```ts
if (thinkingOpened) tui.printThinkingEnd()
```

**Step 4: Run all tests**

```bash
bun test tests/interfaces/repl.test.ts
bun test
```
Expected: All PASS

**Step 5: TypeScript check**

```bash
bun tsc --noEmit
```
Expected: No errors

**Step 6: Commit**

```bash
git add src/interfaces/tui.ts src/interfaces/repl.ts tests/interfaces/repl.test.ts
git commit -m "feat: render thinking tokens dimmed in REPL"
```

---

### Task 10: Full regression run

**Step 1: Run full test suite**

```bash
bun test
```
Expected: All tests pass

**Step 2: TypeScript check**

```bash
bun tsc --noEmit
```
Expected: No errors

**Step 3: Commit if any fixups needed, otherwise done**
