# Context Window Compaction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically compact the message history when it approaches the model's context window limit, using LLM summarization.

**Architecture:** A `beforeModelCall` middleware estimates tokens via `strlen/4`, splits messages into pinned/compactable/recent zones, and summarizes the middle zone via the same provider. A model family registry resolves context window sizes by prefix matching.

**Tech Stack:** TypeScript, Bun test, existing middleware system

---

### Task 1: Model Family Registry

**Files:**
- Create: `src/agent/model-registry.ts`
- Test: `tests/agent/model-registry.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/agent/model-registry.test.ts
import { describe, it, expect } from 'bun:test'
import { getContextWindowSize } from '../../src/agent/model-registry'

describe('getContextWindowSize', () => {
  it('resolves exact family prefix', () => {
    expect(getContextWindowSize('claude-sonnet-4-6')).toBe(200_000)
  })

  it('resolves gpt-4o family', () => {
    expect(getContextWindowSize('gpt-4o-mini')).toBe(128_000)
  })

  it('resolves gemini family', () => {
    expect(getContextWindowSize('gemini-2.0-flash')).toBe(1_048_576)
  })

  it('uses longest prefix match', () => {
    // 'gpt-4-turbo' should match before 'gpt-4'
    expect(getContextWindowSize('gpt-4-turbo-preview')).toBe(128_000)
    expect(getContextWindowSize('gpt-4-0613')).toBe(8_192)
  })

  it('returns fallback for unknown model', () => {
    expect(getContextWindowSize('some-unknown-model')).toBe(128_000)
  })

  it('accepts user override', () => {
    expect(getContextWindowSize('some-unknown-model', 64_000)).toBe(64_000)
  })

  it('user override takes priority over family match', () => {
    expect(getContextWindowSize('claude-sonnet-4-6', 50_000)).toBe(50_000)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/agent/model-registry.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/agent/model-registry.ts
const MODEL_FAMILIES: [string, number][] = [
  ['claude-sonnet', 200_000],
  ['claude-haiku', 200_000],
  ['claude-opus', 200_000],
  ['claude-3.5', 200_000],
  ['claude-3', 200_000],
  ['gpt-4o', 128_000],
  ['gpt-4-turbo', 128_000],
  ['gpt-4', 8_192],
  ['gpt-3.5', 16_385],
  ['o1', 200_000],
  ['o3', 200_000],
  ['gemini-2.5', 1_048_576],
  ['gemini-2.0', 1_048_576],
  ['gemini-1.5', 1_048_576],
]

// Sort by prefix length descending for longest-prefix-first matching
const SORTED_FAMILIES = MODEL_FAMILIES.sort((a, b) => b[0].length - a[0].length)

const DEFAULT_CONTEXT_WINDOW = 128_000

export function getContextWindowSize(model: string, userOverride?: number): number {
  if (userOverride !== undefined) return userOverride
  for (const [prefix, size] of SORTED_FAMILIES) {
    if (model.startsWith(prefix)) return size
  }
  return DEFAULT_CONTEXT_WINDOW
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/agent/model-registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/model-registry.ts tests/agent/model-registry.test.ts
git commit -m "feat: add model family registry for context window sizes"
```

---

### Task 2: Token Estimation Utility

**Files:**
- Create: `src/agent/token-estimator.ts`
- Test: `tests/agent/token-estimator.test.ts`

**Step 1: Write the failing tests**

```typescript
// tests/agent/token-estimator.test.ts
import { describe, it, expect } from 'bun:test'
import { estimateTokens } from '../../src/agent/token-estimator'
import type { IMessage } from '../../src/providers/types'

describe('estimateTokens', () => {
  it('estimates string content as strlen/4', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'abcd' }, // 4 chars = 1 token
    ]
    expect(estimateTokens(messages)).toBe(1)
  })

  it('estimates multi-part content via JSON serialization', () => {
    const messages: IMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]
    const result = estimateTokens(messages)
    expect(result).toBeGreaterThan(0)
  })

  it('includes toolCalls in estimation', () => {
    const withoutTools: IMessage[] = [
      { role: 'assistant', content: 'hi' },
    ]
    const withTools: IMessage[] = [
      { role: 'assistant', content: 'hi', toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{"path":"/foo/bar"}' }] },
    ]
    expect(estimateTokens(withTools)).toBeGreaterThan(estimateTokens(withoutTools))
  })

  it('sums across multiple messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'abcd' },     // 1 token
      { role: 'assistant', content: 'abcd' }, // 1 token
    ]
    expect(estimateTokens(messages)).toBe(2)
  })

  it('rounds up partial tokens', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'ab' }, // 2 chars = ceil(0.5) = 1
    ]
    expect(estimateTokens(messages)).toBe(1)
  })

  it('returns 0 for empty messages', () => {
    expect(estimateTokens([])).toBe(0)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/agent/token-estimator.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/agent/token-estimator.ts
import type { IMessage } from '../providers/types'

export function estimateTokens(messages: IMessage[]): number {
  let total = 0
  for (const m of messages) {
    const content = typeof m.content === 'string'
      ? m.content
      : JSON.stringify(m.content)
    const toolCalls = m.toolCalls ? JSON.stringify(m.toolCalls) : ''
    total += Math.ceil((content.length + toolCalls.length) / 4)
  }
  return total
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/agent/token-estimator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/token-estimator.ts tests/agent/token-estimator.test.ts
git commit -m "feat: add strlen/4 token estimation utility"
```

---

### Task 3: Message Zone Splitter

**Files:**
- Create: `src/agent/context-compaction.ts` (zone splitting logic)
- Test: `tests/agent/context-compaction.test.ts`

This task builds the `splitMessageZones` function that divides messages into pinned/compactable/recent zones while preserving tool call integrity.

**Step 1: Write the failing tests**

```typescript
// tests/agent/context-compaction.test.ts
import { describe, it, expect } from 'bun:test'
import { splitMessageZones } from '../../src/agent/context-compaction'
import type { IMessage } from '../../src/providers/types'

describe('splitMessageZones', () => {
  const sys: IMessage = { role: 'system', content: 'You are helpful.' }
  const user1: IMessage = { role: 'user', content: 'Hello' }
  const asst1: IMessage = { role: 'assistant', content: 'Hi there!' }
  const user2: IMessage = { role: 'user', content: 'Do something' }
  const asst2: IMessage = { role: 'assistant', content: 'Sure', toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }] }
  const tool1: IMessage = { role: 'tool', content: 'file contents', toolCallId: 'tc1' }
  const asst3: IMessage = { role: 'assistant', content: 'Here is the result' }
  const user3: IMessage = { role: 'user', content: 'Thanks' }
  const asst4: IMessage = { role: 'assistant', content: 'You are welcome' }

  it('pins system messages and first user message', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3]
    const { pinned } = splitMessageZones(messages, 20_000)
    expect(pinned).toEqual([sys, user1])
  })

  it('keeps recent messages within token budget', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3, user3, asst4]
    const { recent } = splitMessageZones(messages, 20_000)
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.at(-1)).toEqual(asst4)
  })

  it('does not split tool call from tool result', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3]
    const { recent, compactable } = splitMessageZones(messages, 20_000)
    // If asst2 (with toolCalls) is in recent, tool1 must also be in recent
    if (recent.includes(asst2)) {
      expect(recent).toContain(tool1)
    }
    // If tool1 is in compactable, asst2 must also be in compactable
    if (compactable.includes(tool1)) {
      expect(compactable).toContain(asst2)
    }
  })

  it('returns empty compactable when not enough messages', () => {
    const messages = [sys, user1, asst1]
    const { compactable } = splitMessageZones(messages, 20_000)
    expect(compactable).toEqual([])
  })

  it('all zones together equal original messages', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3, user3, asst4]
    const { pinned, compactable, recent } = splitMessageZones(messages, 20_000)
    expect([...pinned, ...compactable, ...recent]).toEqual(messages)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/agent/context-compaction.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/agent/context-compaction.ts
import type { IMessage } from '../providers/types'
import { estimateTokens } from './token-estimator'

export interface MessageZones {
  pinned: IMessage[]
  compactable: IMessage[]
  recent: IMessage[]
}

export function splitMessageZones(messages: IMessage[], recentBudgetTokens: number): MessageZones {
  // Pin: all leading system messages + first user message
  let pinnedEnd = 0
  for (let i = 0; i < messages.length; i++) {
    pinnedEnd = i + 1
    if (messages[i]!.role === 'user') break
  }
  const pinned = messages.slice(0, pinnedEnd)
  const rest = messages.slice(pinnedEnd)

  if (rest.length === 0) {
    return { pinned, compactable: [], recent: [] }
  }

  // Recent: walk backward from end, accumulating tokens up to budget
  let recentStart = rest.length
  let recentTokens = 0
  for (let i = rest.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([rest[i]!])
    if (recentTokens + msgTokens > recentBudgetTokens && recentStart < rest.length) break
    recentTokens += msgTokens
    recentStart = i
  }

  // Adjust boundary to not split tool call groups
  recentStart = adjustToolCallBoundary(rest, recentStart)

  const compactable = rest.slice(0, recentStart)
  const recent = rest.slice(recentStart)

  return { pinned, compactable, recent }
}

function adjustToolCallBoundary(messages: IMessage[], boundary: number): number {
  if (boundary <= 0 || boundary >= messages.length) return boundary

  const firstRecent = messages[boundary]!
  // If the boundary lands on a tool result, move backward to include its assistant message
  if (firstRecent.role === 'tool') {
    for (let i = boundary - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant' && messages[i]!.toolCalls) {
        return i
      }
    }
  }

  // If boundary lands right after an assistant with toolCalls, include the tool results
  const beforeBoundary = messages[boundary - 1]
  if (beforeBoundary?.role === 'assistant' && beforeBoundary.toolCalls) {
    // The tool results follow — move boundary backward to include the assistant + its tools together
    return boundary - 1
  }

  return boundary
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/agent/context-compaction.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/context-compaction.ts tests/agent/context-compaction.test.ts
git commit -m "feat: add message zone splitter with tool call integrity"
```

---

### Task 4: Add Compaction Config to RaConfig

**Files:**
- Modify: `src/config/types.ts` (add compaction fields to `RaConfig`)
- Modify: `src/config/defaults.ts` (add defaults)

**Step 1: Add compaction types**

Add to `src/config/types.ts`, inside `RaConfig`:

```typescript
compaction: {
  enabled: boolean
  threshold: number      // 0-1, trigger ratio of context window
  maxTokens?: number     // absolute token trigger, overrides threshold * contextWindow
  contextWindow?: number // per-provider override for context window size
}
```

**Step 2: Add defaults**

Add to `src/config/defaults.ts`, in `defaultConfig`:

```typescript
compaction: {
  enabled: true,
  threshold: 0.80,
},
```

**Step 3: Run existing tests to verify nothing breaks**

Run: `bun test`
Expected: all existing tests PASS

**Step 4: Commit**

```bash
git add src/config/types.ts src/config/defaults.ts
git commit -m "feat: add compaction configuration to RaConfig"
```

---

### Task 5: Compaction Middleware

**Files:**
- Modify: `src/agent/context-compaction.ts` (add `createCompactionMiddleware`)
- Modify: `tests/agent/context-compaction.test.ts` (add middleware tests)

**Step 1: Write the failing tests**

Add to `tests/agent/context-compaction.test.ts`:

```typescript
import { createCompactionMiddleware } from '../../src/agent/context-compaction'
import type { IProvider, ChatRequest } from '../../src/providers/types'
import type { ModelCallContext } from '../../src/agent/types'

function makeCtx(messages: IMessage[], model = 'claude-sonnet-4-6'): ModelCallContext {
  const controller = new AbortController()
  const request: ChatRequest = { model, messages: [...messages], tools: [] }
  return {
    stop: () => controller.abort(),
    signal: controller.signal,
    request,
    loop: {
      stop: () => controller.abort(),
      signal: controller.signal,
      messages,
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
    },
  }
}

describe('createCompactionMiddleware', () => {
  it('passes through when under threshold', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8 })
    const messages: IMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    // Messages unchanged — no compaction needed
    expect(ctx.request.messages).toEqual(messages)
  })

  it('compacts when over threshold using maxTokens', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => ({
        message: { role: 'assistant' as const, content: 'Summary of conversation.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    // maxTokens: 10 means trigger at 10 tokens (40 chars)
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, maxTokens: 10 })
    const messages: IMessage[] = [
      { role: 'system', content: 'System prompt here' },
      { role: 'user', content: 'First user message here' },
      { role: 'assistant', content: 'A long assistant response that takes up many tokens in the conversation' },
      { role: 'user', content: 'Another user message' },
      { role: 'assistant', content: 'Another long response from the assistant' },
      { role: 'user', content: 'Latest message' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    // Should have compacted — look for summary marker
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.startsWith('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
    // Should have fewer messages than original
    expect(ctx.request.messages.length).toBeLessThan(messages.length)
  })

  it('skips compaction when disabled', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: false, threshold: 0.8, maxTokens: 1 })
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'A very long message'.repeat(100) },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })

  it('skips when nothing to compact (all pinned)', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, maxTokens: 1 })
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/agent/context-compaction.test.ts`
Expected: FAIL — `createCompactionMiddleware` not exported

**Step 3: Write the middleware implementation**

Add to `src/agent/context-compaction.ts`:

```typescript
import type { IProvider } from '../providers/types'
import type { Middleware, ModelCallContext } from './types'
import { getContextWindowSize } from './model-registry'

export interface CompactionConfig {
  enabled: boolean
  threshold: number
  maxTokens?: number
  contextWindow?: number
}

const SUMMARIZATION_PROMPT = `Summarize the following conversation concisely. Preserve:
- Key decisions made
- Important facts and context established
- Current state of the task being worked on
- Relevant tool results and their outcomes

Be concise but complete. This summary will replace the original messages in the conversation context.

Conversation to summarize:`

export function createCompactionMiddleware(
  provider: IProvider,
  config: CompactionConfig,
): Middleware<ModelCallContext> {
  return async (ctx: ModelCallContext) => {
    if (!config.enabled) return

    const messages = ctx.request.messages
    const estimated = estimateTokens(messages)

    const contextWindow = getContextWindowSize(ctx.request.model, config.contextWindow)
    const triggerThreshold = config.maxTokens ?? Math.floor(contextWindow * config.threshold)

    if (estimated <= triggerThreshold) return

    // Budget for recent zone: enough to leave 80% headroom after compaction
    // Target: pinned + summary ≈ 20% of context window
    // Recent gets whatever fits in that 20% minus pinned and estimated summary overhead
    const targetPostCompaction = Math.floor(contextWindow * 0.20)
    const { pinned, compactable, recent } = splitMessageZones(messages, targetPostCompaction)

    if (compactable.length === 0) return

    // Build summarization content from compactable messages
    const conversationText = compactable.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      const toolInfo = m.toolCalls ? ` [tool calls: ${m.toolCalls.map(t => t.name).join(', ')}]` : ''
      const toolId = m.toolCallId ? ` [tool result for: ${m.toolCallId}]` : ''
      return `${m.role}${toolInfo}${toolId}: ${content}`
    }).join('\n')

    const summaryResponse = await provider.chat({
      model: ctx.request.model,
      messages: [{ role: 'user', content: `${SUMMARIZATION_PROMPT}\n\n${conversationText}` }],
    })

    const summaryContent = typeof summaryResponse.message.content === 'string'
      ? summaryResponse.message.content
      : JSON.stringify(summaryResponse.message.content)

    ctx.request.messages = [
      ...pinned,
      { role: 'user', content: `[Context Summary]\n${summaryContent}` },
      ...recent,
    ]
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/agent/context-compaction.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/agent/context-compaction.ts tests/agent/context-compaction.test.ts
git commit -m "feat: add context compaction middleware with summarization"
```

---

### Task 6: Wire Compaction into Agent Loop

**Files:**
- Modify: `src/agent/loop.ts` (accept compaction config, create middleware)
- Modify: `tests/agent/loop.test.ts` (add integration test)

**Step 1: Write the failing integration test**

Add to `tests/agent/loop.test.ts`:

```typescript
it('compacts messages when exceeding token threshold', async () => {
  let chatCallCount = 0
  let streamCallCount = 0
  const longContent = 'x'.repeat(400) // 100 tokens per message

  const provider: IProvider = {
    name: 'mock',
    chat: async () => {
      chatCallCount++
      return { message: { role: 'assistant' as const, content: 'Summary of prior conversation.' } }
    },
    async *stream() {
      streamCallCount++
      if (streamCallCount <= 5) {
        // First 5 calls: make tool calls to build up history
        yield { type: 'tool_call_start' as const, id: `tc${streamCallCount}`, name: 'echo' }
        yield { type: 'tool_call_delta' as const, id: `tc${streamCallCount}`, argsDelta: '{}' }
        yield { type: 'done' as const }
      } else {
        yield { type: 'text' as const, delta: 'final answer' }
        yield { type: 'done' as const }
      }
    },
  }

  const tools = new ToolRegistry()
  tools.register({ name: 'echo', description: '', inputSchema: {}, execute: async () => longContent })

  const loop = new AgentLoop({
    provider,
    tools,
    maxIterations: 10,
    compaction: { enabled: true, threshold: 0.8, maxTokens: 200 },
  })

  const result = await loop.run([
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Do things' },
  ])

  // provider.chat should have been called at least once for summarization
  expect(chatCallCount).toBeGreaterThan(0)
  // Should still complete normally
  expect(result.messages.at(-1)?.content).toBe('final answer')
})
```

**Step 2: Run tests to verify it fails**

Run: `bun test tests/agent/loop.test.ts`
Expected: FAIL — `compaction` not a recognized option

**Step 3: Wire compaction into AgentLoop**

In `src/agent/loop.ts`:

1. Import `createCompactionMiddleware` and `CompactionConfig`
2. Add `compaction?: CompactionConfig` to `AgentLoopOptions`
3. In the constructor, if `compaction` is provided and `enabled`, prepend the compaction middleware to `beforeModelCall`

```typescript
// Add to imports
import { createCompactionMiddleware, type CompactionConfig } from './context-compaction'

// Add to AgentLoopOptions
compaction?: CompactionConfig

// In constructor, after setting this.middleware:
if (options.compaction?.enabled) {
  this.middleware.beforeModelCall = [
    createCompactionMiddleware(this.provider, options.compaction),
    ...this.middleware.beforeModelCall,
  ]
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/agent/loop.test.ts`
Expected: PASS (all existing + new test)

**Step 5: Run full test suite**

Run: `bun test`
Expected: all PASS

**Step 6: Commit**

```bash
git add src/agent/loop.ts tests/agent/loop.test.ts
git commit -m "feat: wire context compaction middleware into agent loop"
```

---

### Task 7: Wire Config Through Interfaces

**Files:**
- Modify: `src/interfaces/repl.ts` (pass `compaction` config to AgentLoop)
- Modify: `src/interfaces/cli.ts` (pass `compaction` config to AgentLoop)

**Step 1: Check how AgentLoop is constructed in each interface**

Read `src/interfaces/repl.ts` and `src/interfaces/cli.ts` to find where `new AgentLoop(...)` is called.

**Step 2: Pass compaction config from RaConfig**

In both files, add `compaction: config.compaction` to the `AgentLoopOptions` object passed to `new AgentLoop(...)`.

**Step 3: Run full test suite**

Run: `bun test`
Expected: all PASS

**Step 4: Commit**

```bash
git add src/interfaces/repl.ts src/interfaces/cli.ts
git commit -m "feat: pass compaction config to agent loop from CLI and REPL"
```

---

### Task 8: Export Public API

**Files:**
- Modify: `src/agent/index.ts` or main barrel export (if exists)

**Step 1: Export new modules**

Ensure `model-registry`, `token-estimator`, and `context-compaction` are exported from the agent module's public API so they can be used by middleware authors.

**Step 2: Run full test suite**

Run: `bun test`
Expected: all PASS

**Step 3: Commit**

```bash
git add src/agent/index.ts
git commit -m "feat: export context compaction public API"
```
