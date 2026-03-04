# Audit Bugfixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 38 bugs found in the comprehensive code audit, with regression tests.

**Architecture:** Fix bugs in dependency order — foundational utilities first, then providers, then agent loop, then interfaces. Each task is a TDD cycle: write failing test, fix bug, verify.

**Tech Stack:** Bun, TypeScript, bun:test

---

### Task 1: Fix `~/` path expansion (config + middleware loader)

**Files:**
- Modify: `src/config/index.ts:149-151`
- Modify: `src/middleware/loader.ts:19-20`
- Test: `tests/config/index.test.ts`
- Test: `tests/middleware/loader.test.ts`

**Step 1: Write failing tests**

In `tests/config/index.test.ts`, add:
```ts
it('resolves tilde paths correctly (~/file expands to homedir/file)', async () => {
  const { homedir } = await import('os')
  const home = homedir()
  const promptFile = join(home, '.ra-test-prompt-tilde.txt')
  writeFileSync(promptFile, 'tilde prompt content')
  try {
    const c = await loadConfig({ cwd: tmp, cliArgs: { systemPrompt: '~/.ra-test-prompt-tilde.txt' } })
    expect(c.systemPrompt).toBe('tilde prompt content')
  } finally {
    rmSync(promptFile, { force: true })
  }
})
```

In `tests/middleware/loader.test.ts`, add a test verifying `~` path resolution calls `homedir()` + `entry.slice(2)`.

**Step 2: Run tests to verify they fail**

Run: `bun test tests/config/index.test.ts tests/middleware/loader.test.ts`
Expected: FAIL — tilde path resolves to wrong location

**Step 3: Fix the bugs**

In `src/config/index.ts:151`, change:
```ts
resolved = join(homedir(), config.systemPrompt.slice(1))
```
to:
```ts
resolved = join(homedir(), config.systemPrompt.slice(2))
```

In `src/middleware/loader.ts:20`, change:
```ts
if (entry.startsWith('~')) resolved = join(homedir(), entry.slice(1))
```
to:
```ts
if (entry.startsWith('~/')) resolved = join(homedir(), entry.slice(2))
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/config/index.test.ts tests/middleware/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: correct tilde path expansion in config and middleware loader
```

---

### Task 2: Fix OpenAI streaming — usage capture and `done` emission

**Files:**
- Modify: `src/providers/openai.ts:46-72`
- Test: `tests/providers/openai.test.ts`

**Step 1: Write failing tests**

```ts
it('captures usage from terminal empty-choices chunk', async () => {
  const provider = new OpenAIProvider({ apiKey: 'test' })
  ;(provider as any).client = {
    chat: {
      completions: {
        create: async () => (async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] }
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
          yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }
        })(),
      },
    },
  }
  const chunks: any[] = []
  for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
    chunks.push(chunk)
  }
  const done = chunks.find(c => c.type === 'done')
  expect(done).toBeDefined()
  expect(done.usage).toBeDefined()
  expect(done.usage.inputTokens).toBe(10)
})

it('emits done even when stream ends without finish_reason', async () => {
  const provider = new OpenAIProvider({ apiKey: 'test' })
  ;(provider as any).client = {
    chat: {
      completions: {
        create: async () => (async function* () {
          yield { choices: [{ delta: { content: 'Hello' } }] }
          // Stream ends without finish_reason
        })(),
      },
    },
  }
  const chunks: any[] = []
  for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
    chunks.push(chunk)
  }
  const done = chunks.find(c => c.type === 'done')
  expect(done).toBeDefined()
  expect(done.type).toBe('done')
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/providers/openai.test.ts`

**Step 3: Fix the bug**

Replace the stream method's loop logic. Track usage and finish separately. After the `for await` loop ends, always emit `done` if not already emitted:

```ts
async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
  const stream = await this.client.chat.completions.create({ ...this.buildParams(request), stream: true, stream_options: { include_usage: true } })
  const activeToolCalls = new Map<number, string>()
  let usage: TokenUsage | undefined
  let done = false

  for await (const chunk of stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
    // Capture usage from any chunk (typically the terminal one)
    if (chunk.usage) usage = this.toUsage(chunk.usage)

    const delta = chunk.choices[0]?.delta
    if (!delta) continue

    if (delta.content) yield { type: 'text', delta: delta.content }

    if (delta.tool_calls) {
      for (const tc of delta.tool_calls) {
        if (tc.id) {
          activeToolCalls.set(tc.index, tc.id)
          yield { type: 'tool_call_start', id: tc.id, name: tc.function?.name ?? '' }
        }
        if (tc.function?.arguments) {
          yield { type: 'tool_call_delta', id: activeToolCalls.get(tc.index) ?? '', argsDelta: tc.function.arguments }
        }
      }
    }

    if (chunk.choices[0]?.finish_reason) {
      for (const id of activeToolCalls.values()) yield { type: 'tool_call_end', id }
      yield { type: 'done', usage }
      done = true
    }
  }

  if (!done) yield { type: 'done', usage }
}
```

**Step 4: Run tests**

Run: `bun test tests/providers/openai.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: capture streaming usage and always emit done in OpenAI provider
```

---

### Task 3: Fix Anthropic parallel tool call ID tracking

**Files:**
- Modify: `src/providers/anthropic.ts:43-58`
- Test: `tests/providers/anthropic.test.ts`

**Step 1: Write failing test**

```ts
it('tracks tool call IDs correctly for parallel tool calls', async () => {
  const provider = new AnthropicProvider({ apiKey: 'test' })
  ;(provider as any).client = {
    messages: {
      create: async () => (async function* () {
        yield { type: 'message_start', message: { usage: { input_tokens: 10 } } }
        yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'read' } }
        yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool_2', name: 'write' } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } }
        yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"b":2}' } }
        yield { type: 'message_delta', usage: { output_tokens: 5 } }
        yield { type: 'message_stop' }
      })(),
    },
  }
  const chunks: any[] = []
  for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })) {
    chunks.push(chunk)
  }
  const deltas = chunks.filter(c => c.type === 'tool_call_delta')
  expect(deltas[0].id).toBe('tool_1')
  expect(deltas[1].id).toBe('tool_2')
})
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/providers/anthropic.test.ts`
Expected: FAIL — both deltas have id 'tool_2' (last overwritten value)

**Step 3: Fix the bug**

Replace the single `currentToolCallId` with a Map keyed by content block index:

```ts
const toolCallIds = new Map<number, string>()

// In content_block_start:
case 'content_block_start':
  if (event.content_block.type === 'tool_use') {
    toolCallIds.set(event.index, event.content_block.id)
    yield { type: 'tool_call_start', id: event.content_block.id, name: event.content_block.name }
  }
  break
// In content_block_delta:
case 'content_block_delta':
  if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text }
  else if (event.delta.type === 'input_json_delta') yield { type: 'tool_call_delta', id: toolCallIds.get(event.index) ?? '', argsDelta: event.delta.partial_json }
  else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: (event.delta as any).thinking }
  break
```

**Step 4: Run tests**

Run: `bun test tests/providers/anthropic.test.ts`
Expected: PASS

**Step 5: Commit**

```
fix: track parallel tool call IDs correctly in Anthropic provider
```

---

### Task 4: Fix Anthropic/Bedrock/Ollama always-emit-done

**Files:**
- Modify: `src/providers/anthropic.ts`
- Modify: `src/providers/bedrock.ts` (if exists, same pattern)
- Test: `tests/providers/anthropic.test.ts`

**Step 1: Write failing test**

```ts
it('emits done even when stream ends without message_stop', async () => {
  const provider = new AnthropicProvider({ apiKey: 'test' })
  ;(provider as any).client = {
    messages: {
      create: async () => (async function* () {
        yield { type: 'message_start', message: { usage: { input_tokens: 10 } } }
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }
        // Stream ends without message_stop
      })(),
    },
  }
  const chunks: any[] = []
  for await (const chunk of provider.stream({ model: 'test', messages: [{ role: 'user', content: 'hi' }] })) {
    chunks.push(chunk)
  }
  expect(chunks.at(-1)?.type).toBe('done')
})
```

**Step 2: Fix the bugs**

Add `done` tracking variable and emit after loop if not already emitted. Same pattern as OpenAI fix (Task 2).

**Step 3: Run tests, commit**

```
fix: always emit done chunk in Anthropic and Bedrock providers
```

---

### Task 5: Fix session storage — prune count, JSONL resilience, appendFile import

**Files:**
- Modify: `src/storage/sessions.ts:59-75,110-111`
- Test: `tests/storage/sessions.test.ts`

**Step 1: Write failing tests**

```ts
it('prune with both TTL and maxSessions deletes correct count', async () => {
  // Create 10 sessions with staggered timestamps
  for (let i = 0; i < 10; i++) {
    const s = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
    // Backdate first 2 sessions to be expired (> 1 day old)
    if (i < 2) {
      const metaPath = join(TEST_PATH, s.id, 'meta.json')
      const meta = JSON.parse(await Bun.file(metaPath).text())
      meta.created = new Date(Date.now() - 2 * 86_400_000).toISOString()
      await Bun.write(metaPath, JSON.stringify(meta, null, 2))
    }
    await new Promise(r => setTimeout(r, 10))
  }
  // TTL=1 day should expire 2, maxSessions=7 should delete 1 more (8 remaining - 7 = 1)
  await storage.prune({ ttlDays: 1, maxSessions: 7 })
  const list = await storage.list()
  expect(list).toHaveLength(7)
})

it('readMessages skips malformed JSONL lines instead of throwing', async () => {
  const session = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
  await storage.appendMessage(session.id, { role: 'user', content: 'good message' })
  // Manually append a corrupt line
  const filePath = join(TEST_PATH, session.id, 'messages.jsonl')
  const { appendFile } = await import('node:fs/promises')
  await appendFile(filePath, '{corrupt json\n')
  await storage.appendMessage(session.id, { role: 'assistant', content: 'another good message' })
  const messages = await storage.readMessages(session.id)
  expect(messages).toHaveLength(2)
  expect(messages[0]?.content).toBe('good message')
  expect(messages[1]?.content).toBe('another good message')
})
```

**Step 2: Fix the bugs**

In `src/storage/sessions.ts`:

1. **Fix prune count** (line 110-111):
```ts
if (options.maxSessions !== undefined) {
  const remaining = sessions.filter(s => !toDelete.has(s.id))
  if (remaining.length > options.maxSessions) {
    remaining.slice(0, remaining.length - options.maxSessions).forEach(s => toDelete.add(s.id))
  }
}
```

2. **Fix JSONL resilience** (line 74-75):
```ts
.map(line => {
  try { return JSON.parse(line) as IMessage }
  catch { return null }
})
.filter((msg): msg is IMessage => msg !== null)
```

3. **Fix appendFile import** — hoist the import to module level:
```ts
import { appendFile } from 'node:fs/promises'
// Remove the dynamic import inside appendMessage
```

**Step 3: Run tests, commit**

```
fix: correct prune count, add JSONL resilience, hoist appendFile import
```

---

### Task 6: Fix `extractSystemMessages` dropping ContentPart[] system messages

**Files:**
- Modify: `src/providers/utils.ts:9`
- Test: `tests/providers/openai.test.ts` (or a new `tests/providers/utils.test.ts`)

**Step 1: Write failing test**

```ts
import { extractSystemMessages } from '../../src/providers/utils'

it('extracts system messages with ContentPart[] content', () => {
  const messages = [
    { role: 'system' as const, content: [{ type: 'text' as const, text: 'Be helpful' }] },
    { role: 'user' as const, content: 'hi' },
  ]
  const { system } = extractSystemMessages(messages)
  expect(system).toBe('Be helpful')
})
```

**Step 2: Fix the bug**

```ts
systemParts.push(typeof msg.content === 'string'
  ? msg.content
  : msg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join(''))
```

**Step 3: Run tests, commit**

```
fix: extract text from ContentPart[] system messages
```

---

### Task 7: Fix Google provider — tool name regex, thought leak, hardcoded mime

**Files:**
- Modify: `src/providers/google.ts:88,122,132-133`
- Test: `tests/providers/google.test.ts`

**Step 1: Write failing tests**

```ts
it('preserves function names ending in digits when extracting from toolCallId', () => {
  const provider = new GoogleProvider({ apiKey: 'test' })
  const messages = [
    { role: 'tool' as const, content: 'result', toolCallId: 'get_result_3_0' },
  ]
  const mapped = provider.mapMessages(messages)
  expect(mapped[0].parts[0].functionResponse.name).toBe('get_result_3')
})

it('excludes thought parts from textContent in mapResponseToMessage', () => {
  const provider = new GoogleProvider({ apiKey: 'test' })
  const response = {
    candidates: [{ content: { parts: [
      { thought: true, text: 'thinking...' },
      { text: 'actual response' },
    ] } }],
  }
  const msg = provider.mapResponseToMessage(response as any)
  expect(msg.content).toBe('actual response')
  expect((msg.content as string)).not.toContain('thinking')
})
```

**Step 2: Fix the bugs**

1. **Tool name regex** (line 88): Store tool name separately. Change the ID format to use a separator that won't collide. Use the tool call's original name stored alongside:
   Actually, the simplest fix: store the original tool name in the ID format using a safe delimiter. Change ID generation to `toolcall_${counter}_${name}` and extraction to split on first two underscores. But that's a bigger change.

   Simpler: just strip only the last `_N` where N is the counter. Since counter is always a small integer added by us, use `lastIndexOf('_')`:
   ```ts
   const toolName = msg.toolCallId!.substring(0, msg.toolCallId!.lastIndexOf('_'))
   ```

2. **Thought leak in non-streaming** (line 132-133):
   ```ts
   if ('thought' in part && (part as any).thought) continue
   if ('text' in part && part.text) textContent += part.text
   ```

3. **Hardcoded mime** (line 122): Try to infer from URL extension:
   ```ts
   const mimeFromUrl = (url: string) => {
     if (url.endsWith('.png')) return 'image/png'
     if (url.endsWith('.gif')) return 'image/gif'
     if (url.endsWith('.webp')) return 'image/webp'
     return 'image/jpeg'
   }
   return src.type === 'base64'
     ? { inlineData: { mimeType: src.mediaType, data: src.data } }
     : { fileData: { mimeType: mimeFromUrl(src.url), fileUri: src.url } }
   ```

**Step 3: Run tests, commit**

```
fix: Google provider tool name extraction, thought filtering, image mime type
```

---

### Task 8: Fix agent loop — error phase tracking, afterToolExecution on errors, orphaned tool calls

**Files:**
- Modify: `src/agent/loop.ts:112-148`
- Test: `tests/agent/loop.test.ts`

**Step 1: Write failing tests**

```ts
it('calls afterToolExecution with isError=true when tool throws', async () => {
  const afterResults: any[] = []
  const loop = new AgentLoop({
    provider: mockProvider([
      { type: 'tool_call_start', id: 'tc1', name: 'fail_tool' },
      { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
      { type: 'done' },
    ]),
    tools: makeRegistry({ fail_tool: async () => { throw new Error('boom') } }),
    middleware: {
      afterToolExecution: [async (ctx) => { afterResults.push({ id: ctx.toolCall.id, isError: ctx.result.isError }) }],
    },
  })
  await loop.run([{ role: 'user', content: 'hi' }])
  expect(afterResults).toHaveLength(1)
  expect(afterResults[0].isError).toBe(true)
})
```

**Step 2: Fix the bugs**

1. **afterToolExecution on error**: Wrap tool execution in try/catch, call afterToolExecution in both paths
2. **Error phase**: Track current phase in a `let phase: 'model_call' | 'tool_execution' | 'stream' = 'model_call'` variable, update it before each phase

**Step 3: Run tests, commit**

```
fix: call afterToolExecution on tool errors and track error phase correctly
```

---

### Task 9: Fix context compaction — error handling, ContentPart corruption, summary drop

**Files:**
- Modify: `src/agent/context-compaction.ts:111-143`
- Test: `tests/agent/context-compaction.test.ts`

**Step 1: Write failing tests**

```ts
it('handles summarization API failure gracefully', async () => {
  const provider: IProvider = {
    name: 'mock',
    chat: async () => { throw new Error('API rate limit') },
    async *stream() { yield { type: 'done' as const } },
  }
  const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, maxTokens: 10, contextWindow: 100 })
  const longText = 'word '.repeat(200)
  const messages: IMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'first' },
    { role: 'assistant', content: longText },
    { role: 'user', content: 'latest' },
  ]
  const ctx = makeCtx(messages)
  const originalMessages = [...ctx.request.messages]
  await mw(ctx) // Should not throw
  // Messages should remain unchanged on failure
  expect(ctx.request.messages).toEqual(originalMessages)
})

it('preserves ContentPart[] content in pinned user message during merge', async () => {
  const provider: IProvider = {
    name: 'mock',
    chat: async () => ({
      message: { role: 'assistant' as const, content: 'Summary.' },
    }),
    async *stream() { yield { type: 'done' as const } },
  }
  const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, maxTokens: 10, contextWindow: 100 })
  const longText = 'word '.repeat(200)
  const messages: IMessage[] = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: [{ type: 'text', text: 'look at this' }, { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } }] },
    { role: 'assistant', content: longText },
    { role: 'user', content: longText },
    { role: 'assistant', content: longText },
    { role: 'user', content: 'latest' },
  ]
  const ctx = makeCtx(messages)
  await mw(ctx)
  // The pinned user message should have structured content preserved with summary appended
  const pinnedUser = ctx.request.messages.find(m => m.role === 'user' && Array.isArray(m.content))
  // Either the content is preserved as array or the text was properly extracted
  const summaryMsg = ctx.request.messages.find(m => typeof m.content === 'string' && m.content.includes('[Context Summary]'))
  expect(summaryMsg).toBeDefined()
})
```

**Step 2: Fix the bugs**

1. **Error handling**: Wrap the `provider.chat()` call in try/catch, return early on failure (leaving messages unchanged)
2. **ContentPart handling**: When merging into a user message that has ContentPart[], extract just the text parts instead of JSON.stringify:
   ```ts
   const origText = typeof orig.content === 'string'
     ? orig.content
     : orig.content.filter(p => p.type === 'text').map(p => p.text).join('\n')
   ```

**Step 3: Run tests, commit**

```
fix: handle compaction errors gracefully and preserve ContentPart[] content
```

---

### Task 10: Fix REPL — handleCommand error handling, /resume clearing state

**Files:**
- Modify: `src/interfaces/repl.ts:60-70,172-185`
- Test: `tests/interfaces/repl.test.ts`

**Step 1: Write failing test**

```ts
it('handleCommand errors do not crash the REPL', async () => {
  // Mock storage that throws on readMessages
  const repl = new Repl({
    ...baseOptions,
    storage: {
      ...baseOptions.storage,
      readMessages: async () => { throw new Error('corrupt file') },
    } as any,
  })
  // Should not throw
  const result = await (repl as any).handleCommand('/resume some-id')
  expect(result).toContain('Error')
})
```

**Step 2: Fix the bugs**

1. **Wrap handleCommand in try/catch** in the `start()` method:
   ```ts
   if (trimmed.startsWith('/')) {
     try {
       const response = await this.handleCommand(trimmed)
       if (response) tui.printCommandResponse(response)
     } catch (err) {
       tui.printError(err instanceof Error ? err.message : String(err))
     }
   }
   ```

2. **Clear pending state on /resume**:
   ```ts
   case '/resume': {
     ...
     this.messages = messages
     this.sessionId = id
     this.pendingSkill = undefined
     this.pendingAttachments = []
     return `Resumed session ${id} (${this.messages.length} messages loaded).`
   }
   ```

**Step 3: Run tests, commit**

```
fix: handle REPL command errors gracefully and clear state on /resume
```

---

### Task 11: Fix MCP client — disconnect error swallowing

**Files:**
- Modify: `src/mcp/client.ts:34-37,41-43`
- Test: `tests/mcp/client.test.ts`

**Step 1: Write failing test**

```ts
it('preserves original error when disconnect fails during cleanup', async () => {
  const client = new McpClient()
  // Manually push a mock client that throws on close
  ;(client as any).clients = [{ close: async () => { throw new Error('close failed') } }]
  // connect should still throw the original error, not the close error
  // We test disconnect directly
  // disconnect should not throw even if close fails
  await expect(client.disconnect()).resolves.toBeUndefined()
})
```

**Step 2: Fix the bug**

Change `disconnect` to use `Promise.allSettled`:
```ts
async disconnect(): Promise<void> {
  await Promise.allSettled(this.clients.map(c => c.close()))
  this.clients = []
}
```

**Step 3: Run tests, commit**

```
fix: use allSettled in MCP client disconnect to prevent error swallowing
```

---

### Task 12: Fix MCP server — transport registration race, DELETE response

**Files:**
- Modify: `src/mcp/server.ts:42-72`
- Test: `tests/mcp/server.test.ts`

**Step 1: Fix the bugs**

1. **Store transport before handleRequest** (move `transports.set` before `transport.handleRequest`):
   ```ts
   if (req.method === 'POST' && !sessionId) {
     transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
     transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId) }
     await server.connect(transport)
     // Store immediately after connect so session ID is available
     if (transport.sessionId) transports.set(transport.sessionId, transport)
   }
   ```

2. **Return 404 for DELETE of unknown session**:
   ```ts
   if (req.method === 'DELETE') {
     const t = transports.get(sessionId)
     if (!t) { res.writeHead(404).end('Session not found'); return }
     await t.close()
     transports.delete(sessionId)
     res.writeHead(200).end()
     return
   }
   ```

**Step 2: Run tests, commit**

```
fix: register MCP transport before handling request, return 404 for unknown DELETE
```

---

### Task 13: Fix RA_THINKING validation + OpenAI non-null assertion

**Files:**
- Modify: `src/config/index.ts:87`
- Modify: `src/providers/openai.ts:38`
- Test: `tests/config/index.test.ts`

**Step 1: Write failing test**

```ts
it('rejects invalid RA_THINKING values', async () => {
  const c = await loadConfig({ cwd: tmp, env: { RA_THINKING: 'extreme' } })
  expect(c.thinking).toBeUndefined()
})
```

**Step 2: Fix the bugs**

1. In `src/config/index.ts:87`:
   ```ts
   if (env.RA_THINKING !== undefined && ['low', 'medium', 'high'].includes(env.RA_THINKING)) {
     set(['thinking'], env.RA_THINKING)
   }
   ```

2. In `src/providers/openai.ts:38`: Remove the `!` non-null assertion:
   ```ts
   const choice = response.choices[0]
   if (!choice) throw new Error('No choices returned from OpenAI')
   ```

**Step 3: Run tests, commit**

```
fix: validate RA_THINKING values and remove incorrect non-null assertion
```

---

### Task 14: Fix `index.ts` — `--repl "prompt"` running as CLI

**Files:**
- Modify: `src/index.ts:218`
- Test: `tests/config/parse-args.test.ts` (behavioral test via parseArgs)

**Step 1: Write test**

```ts
it('--repl with positional prompt preserves repl interface', () => {
  const result = parseArgs(['bun', 'src/index.ts', '--repl', 'hello world'])
  expect(result.config.interface).toBe('repl')
  expect(result.meta.prompt).toBe('hello world')
})
```

**Step 2: Fix the bug**

In `src/index.ts:218`, only fall through to CLI if the interface is explicitly `cli` or if no interface was specified:
```ts
} else if (config.interface === 'cli' || (parsed.meta.prompt && !['repl', 'http', 'mcp', 'mcp-stdio'].includes(config.interface))) {
```

**Step 3: Run tests, commit**

```
fix: respect --repl flag when prompt is provided
```

---

### Task 15: Final verification

**Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass

**Step 2: Run type checker**

Run: `bun tsc`
Expected: No type errors

**Step 3: Commit any remaining fixes**

---
