import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockQuery = mock()
const mockCreateSdkMcpServer = mock()
const mockSdkTool = mock()

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: mockSdkTool,
}))

import { AnthropicAgentsSdkProvider } from '@chinmaymk/ra'

function streamEvent(event: unknown) {
  return { type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: 's' }
}

function resultMsg(overrides: Record<string, unknown> = {}) {
  return { type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 }, uuid: 'u', session_id: 's', ...overrides }
}

function mockQueryWith(...messages: unknown[]) {
  mockQuery.mockReturnValue((async function* () { for (const m of messages) yield m })())
}

async function collect(stream: AsyncIterable<unknown>) {
  const chunks: unknown[] = []
  for await (const c of stream) chunks.push(c)
  return chunks
}

describe('AnthropicAgentsSdkProvider', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockCreateSdkMcpServer.mockReset()
    mockSdkTool.mockReset()
    mockSdkTool.mockImplementation((name: string, desc: string, schema: unknown, handler: unknown) => ({
      name, description: desc, inputSchema: schema, handler,
    }))
    mockCreateSdkMcpServer.mockReturnValue({ type: 'sdk', instance: {} })
  })

  it('has correct provider name', () => {
    expect(new AnthropicAgentsSdkProvider().name).toBe('anthropic-agents-sdk')
  })

  // ── Context isolation ─────────────────────────────────────────────

  describe('context isolation', () => {
    beforeEach(() => mockQueryWith(resultMsg()))

    async function getOptions(overrides = {}) {
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], ...overrides }))
      return mockQuery.mock.calls[0]![0].options
    }

    it('disables all setting sources', async () => { expect((await getOptions()).settingSources).toEqual([]) })
    it('disables session persistence', async () => { expect((await getOptions()).persistSession).toBe(false) })
    it('disables auto-memory and auto-dream', async () => {
      const o = await getOptions()
      expect(o.settings.autoMemoryEnabled).toBe(false)
      expect(o.settings.autoDreamEnabled).toBe(false)
    })
    it('disables git instructions and gitignore', async () => {
      const o = await getOptions()
      expect(o.settings.includeGitInstructions).toBe(false)
      expect(o.settings.respectGitignore).toBe(false)
    })
    it('disables file checkpointing', async () => { expect((await getOptions()).enableFileCheckpointing).toBe(false) })
    it('enables partial messages for streaming', async () => { expect((await getOptions()).includePartialMessages).toBe(true) })
    it('disables plugins', async () => { expect((await getOptions()).plugins).toEqual([]) })
    it('disables built-in tools', async () => { expect((await getOptions()).tools).toEqual([]) })
    it('bypasses permissions', async () => {
      const o = await getOptions()
      expect(o.permissionMode).toBe('bypassPermissions')
      expect(o.allowDangerouslySkipPermissions).toBe(true)
    })
    it('replaces system prompt', async () => {
      const o = await getOptions({ messages: [{ role: 'system', content: 'Pirate.' }, { role: 'user', content: 'hi' }] })
      expect(o.systemPrompt).toBe('Pirate.')
    })
    it('does not set maxTurns — SDK owns the agentic loop', async () => {
      expect((await getOptions()).maxTurns).toBeUndefined()
    })
  })

  // ── buildOptions ──────────────────────────────────────────────────

  describe('buildOptions', () => {
    it('maps thinking with budget cap', () => {
      const o = new AnthropicAgentsSdkProvider().buildOptions({ model: 'x', messages: [], thinking: 'high', thinkingBudgetCap: 10000 })
      expect((o.thinking as { budgetTokens: number }).budgetTokens).toBe(10000)
    })
    it('maps thinking to effort', () => {
      expect(new AnthropicAgentsSdkProvider().buildOptions({ model: 'x', messages: [], thinking: 'low' }).effort).toBe('low')
    })
    it('does not set maxTurns', () => {
      const o = new AnthropicAgentsSdkProvider().buildOptions({ model: 'x', messages: [] }) as Record<string, unknown>
      expect(o.maxTurns).toBeUndefined()
    })
  })

  // ── formatConversation ─────────────────────────────────────────────

  describe('formatConversation', () => {
    const provider = new AnthropicAgentsSdkProvider()

    it('opens with a stable conversation_history anchor and no closing tag', () => {
      const result = provider.formatConversation([{ role: 'user', content: 'hello' }])
      expect(result).toStartWith('<conversation_history>')
      expect(result).not.toContain('</conversation_history>')
      expect(result).toContain('<user>\nhello\n</user>')
    })

    it('includes user and assistant messages', () => {
      const result = provider.formatConversation([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello!' },
      ])
      expect(result).toContain('<user>\nhi\n</user>')
      expect(result).toContain('<assistant>\nhello!\n</assistant>')
    })

    it('omits tool messages — the SDK resolved them internally', () => {
      const result = provider.formatConversation([
        { role: 'user', content: 'read it' },
        { role: 'assistant', content: 'Sure, reading now.' },
        { role: 'tool', content: 'file contents', toolCallId: 'tc_1' },
      ])
      expect(result).not.toContain('<tool_result')
      expect(result).not.toContain('<tool_call')
      expect(result).toContain('<user>')
      expect(result).toContain('<assistant>')
    })

    it('is append-only: each new turn is a byte-prefix of the next', () => {
      const turn1 = provider.formatConversation([{ role: 'user', content: 'hi' }])
      const turn2 = provider.formatConversation([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello!' },
      ])
      expect(turn2.startsWith(turn1)).toBe(true)
    })
  })

  // ── MCP tools ────────────────────────────────────────────────────

  describe('buildMcpTools', () => {
    it('registers tools with real handlers that call execute()', async () => {
      const executeFn = mock(() => Promise.resolve('file contents'))
      new AnthropicAgentsSdkProvider().buildMcpTools([
        { name: 'read', description: 'read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, execute: executeFn },
      ])
      expect(mockSdkTool).toHaveBeenCalledTimes(1)
      expect(mockSdkTool.mock.calls[0]![0]).toBe('read')

      const handler = mockSdkTool.mock.calls[0]![3] as (input: unknown) => Promise<unknown>
      const result = await handler({ path: 'test.txt' }) as { content: { text: string }[] }
      expect(executeFn).toHaveBeenCalledWith({ path: 'test.txt' })
      expect(result.content[0]!.text).toBe('file contents')
    })

    it('catches tool errors and returns isError result', async () => {
      const executeFn = mock(() => Promise.reject(new Error('not found')))
      new AnthropicAgentsSdkProvider().buildMcpTools([
        { name: 'read', description: 'read', inputSchema: { type: 'object', properties: {} }, execute: executeFn },
      ])
      const handler = mockSdkTool.mock.calls[0]![3] as (input: unknown) => Promise<unknown>
      const result = await handler({}) as { content: { text: string }[]; isError: boolean }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toBe('not found')
    })
  })

  // ── stream() ──────────────────────────────────────────────────────

  describe('stream()', () => {
    it('passes prompt as an async iterable (streaming-input mode)', async () => {
      mockQueryWith(resultMsg())
      await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      const { prompt } = mockQuery.mock.calls[0]![0]
      expect(prompt[Symbol.asyncIterator]).toBeDefined()

      // The channel is a persistent pushable async iterable — drain the first
      // queued message only, don't iterate to completion (which would hang).
      const iter = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]()
      const first = await iter.next()
      expect(first.done).toBe(false)
      const msg = first.value as { type: string; message: { role: string; content: string } }
      expect(msg.type).toBe('user')
      expect(msg.message.content).toStartWith('<conversation_history>')
    })

    it('yields text chunks', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    })

    it('yields thinking chunks', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'think' }] }))
      expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Hmm' })
    })

    it('does NOT yield tool_call chunks — SDK handles tools internally', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_1', name: 'read_file' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"foo.txt"}' } }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'read foo' }] })) as { type: string }[]
      const types = chunks.map(c => c.type)
      expect(types).toEqual(['done'])
      expect(types).not.toContain('tool_call_start')
    })

    it('yields text from multi-turn SDK loop (text → tool → text)', async () => {
      mockQueryWith(
        // First model call: text + tool_use
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading...' } }),
        streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_1', name: 'read' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        // SDK executes tool internally, then second model call:
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' Done!' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] })) as { type: string; delta?: string }[]
      const textChunks = chunks.filter(c => c.type === 'text')
      expect(textChunks).toEqual([
        { type: 'text', delta: 'Reading...' },
        { type: 'text', delta: ' Done!' },
      ])
    })

    it('extracts usage from modelUsage (with cache tokens)', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
        resultMsg({
          usage: { input_tokens: 100, output_tokens: 20 },
          modelUsage: {
            'claude-sonnet-4-6': { inputTokens: 100, outputTokens: 20, cacheReadInputTokens: 500, cacheCreationInputTokens: 200 },
          },
        }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const done = chunks.find((c: any) => c.type === 'done')
      expect(done.usage.inputTokens).toBe(800)
      expect(done.usage.outputTokens).toBe(20)
      expect(done.usage.cacheReadTokens).toBe(500)
      expect(done.usage.cacheCreationTokens).toBe(200)
    })

    it('falls back to raw usage when modelUsage is absent', async () => {
      mockQueryWith(
        resultMsg({ usage: { input_tokens: 42, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 } }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const done = chunks.find((c: any) => c.type === 'done')
      expect(done.usage.inputTokens).toBe(192)
      expect(done.usage.outputTokens).toBe(7)
      expect(done.usage.cacheReadTokens).toBe(100)
      expect(done.usage.cacheCreationTokens).toBe(50)
    })

    it('always yields done', async () => {
      mockQueryWith({ type: 'system', subtype: 'init', session_id: 's', uuid: 'u' })
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
    })

    it('handles pre-aborted signals', async () => {
      const c = new AbortController(); c.abort()
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], signal: c.signal }))
      expect(chunks).toEqual([{ type: 'done' }])
    })
  })

  // ── persistent session (one subprocess per provider) ─────────────

  describe('persistent session', () => {
    /**
     * Build a fake Query that reads from the channel (prompt) and replies
     * with a scripted batch of events for each user message it receives.
     * Mirrors how the real CLI subprocess keeps the process alive across turns.
     */
    function persistentQueryMock(batches: unknown[][]) {
      let batchIdx = 0
      return (params: { prompt: AsyncIterable<unknown>; options: unknown }) => {
        const prompt = params.prompt
        const inputIter = prompt[Symbol.asyncIterator]()
        const outQueue: unknown[] = []
        let pendingResolve: ((r: IteratorResult<unknown, void>) => void) | null = null
        let closed = false

        async function pump() {
          while (!closed) {
            const { done } = await inputIter.next()
            if (done) { closed = true; break }
            const batch = batches[batchIdx++] ?? []
            for (const msg of batch) {
              if (pendingResolve) {
                const r = pendingResolve; pendingResolve = null
                r({ value: msg, done: false })
              } else {
                outQueue.push(msg)
              }
            }
          }
          if (pendingResolve) {
            const r = pendingResolve; pendingResolve = null
            r({ value: undefined, done: true })
          }
        }
        void pump()

        const q = {
          next: (): Promise<IteratorResult<unknown, void>> => {
            if (outQueue.length > 0) return Promise.resolve({ value: outQueue.shift()!, done: false })
            if (closed) return Promise.resolve({ value: undefined, done: true })
            return new Promise(resolve => { pendingResolve = resolve })
          },
          interrupt: async () => { /* noop */ },
          close: () => {
            closed = true
            if (pendingResolve) {
              const r = pendingResolve; pendingResolve = null
              r({ value: undefined, done: true })
            }
          },
          [Symbol.asyncIterator]() { return this },
        }
        return q
      }
    }

    it('reuses a single query() across multiple stream() calls', async () => {
      mockQuery.mockImplementation(persistentQueryMock([
        [streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'first' } }), resultMsg()],
        [streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'second' } }), resultMsg()],
      ]))

      const provider = new AnthropicAgentsSdkProvider()
      const t1 = await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as { type: string; delta?: string }[]
      const t2 = await collect(provider.stream({ model: 'x', messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'first' },
        { role: 'user', content: 'again' },
      ] })) as { type: string; delta?: string }[]

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(t1.find(c => c.type === 'text')?.delta).toBe('first')
      expect(t2.find(c => c.type === 'text')?.delta).toBe('second')
      await provider.close()
    })

    it('pushes only new user messages on follow-up turns (raw text, not re-wrapped history)', async () => {
      let pushedInputs: { type: string; message: { content: string } }[] = []
      mockQuery.mockImplementation((params: { prompt: AsyncIterable<unknown> }) => {
        const iter = params.prompt[Symbol.asyncIterator]()
        let closed = false
        async function drainOne() {
          const r = await iter.next()
          if (!r.done) pushedInputs.push(r.value as { type: string; message: { content: string } })
        }
        return {
          next: async () => {
            if (closed) return { value: undefined, done: true }
            await drainOne()
            closed = true
            return { value: resultMsg(), done: false }
          },
          interrupt: async () => {},
          close: () => { closed = true },
          [Symbol.asyncIterator]() { return this },
        }
      })

      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      // The mock above only drains one message per turn, so reset and switch
      // mock for a second turn-aware scenario using the persistent mock.
      pushedInputs = []
      mockQuery.mockImplementation(persistentQueryMock([
        [resultMsg()],
        [resultMsg()],
      ]))
      const provider2 = new AnthropicAgentsSdkProvider()
      // Capture what gets pushed into the channel via the mock
      const captured: string[] = []
      const originalImpl = mockQuery.getMockImplementation()!
      mockQuery.mockImplementation((params: { prompt: AsyncIterable<unknown>; options: unknown }) => {
        const realIter = params.prompt[Symbol.asyncIterator]()
        const wrapped: AsyncIterable<unknown> = {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                const r = await realIter.next()
                if (!r.done) captured.push((r.value as { message: { content: string } }).message.content)
                return r
              },
            }
          },
        }
        return originalImpl({ prompt: wrapped, options: params.options })
      })

      await collect(provider2.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      await collect(provider2.stream({ model: 'x', messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'next' },
      ] }))

      expect(captured[0]).toStartWith('<conversation_history>')
      expect(captured[1]).toBe('next')
      await provider2.close()
    })

    it('starts a fresh subprocess when the model changes', async () => {
      mockQuery.mockImplementation(persistentQueryMock([[resultMsg()], [resultMsg()]]))
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'a', messages: [{ role: 'user', content: 'hi' }] }))
      await collect(provider.stream({ model: 'b', messages: [{ role: 'user', content: 'hi' }] }))
      expect(mockQuery).toHaveBeenCalledTimes(2)
      await provider.close()
    })

    it('starts a fresh subprocess when the system prompt changes', async () => {
      mockQuery.mockImplementation(persistentQueryMock([[resultMsg()], [resultMsg()]]))
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [{ role: 'system', content: 'A.' }, { role: 'user', content: 'hi' }] }))
      await collect(provider.stream({ model: 'x', messages: [{ role: 'system', content: 'B.' }, { role: 'user', content: 'hi' }] }))
      expect(mockQuery).toHaveBeenCalledTimes(2)
      await provider.close()
    })

    it('starts a fresh subprocess when tool schemas change', async () => {
      mockQuery.mockImplementation(persistentQueryMock([[resultMsg()], [resultMsg()]]))
      const provider = new AnthropicAgentsSdkProvider()
      const toolA = { name: 'a', description: 'a', inputSchema: { type: 'object', properties: {} }, execute: async () => 'ok' }
      const toolB = { name: 'b', description: 'b', inputSchema: { type: 'object', properties: {} }, execute: async () => 'ok' }
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools: [toolA] }))
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools: [toolB] }))
      expect(mockQuery).toHaveBeenCalledTimes(2)
      await provider.close()
    })

    it('reuses the subprocess when tools swap execute() refs but keep schemas', async () => {
      mockQuery.mockImplementation(persistentQueryMock([[resultMsg()], [resultMsg()]]))
      const provider = new AnthropicAgentsSdkProvider()
      const tool1 = { name: 'x', description: 'd', inputSchema: { type: 'object', properties: {} }, execute: async () => 'one' }
      const tool2 = { name: 'x', description: 'd', inputSchema: { type: 'object', properties: {} }, execute: async () => 'two' }
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools: [tool1] }))
      await collect(provider.stream({ model: 'x', messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'again' },
      ], tools: [tool2] }))
      expect(mockQuery).toHaveBeenCalledTimes(1)

      // The MCP handler registered at session creation should, when invoked,
      // resolve through the mutable map and call tool2.execute (the latest ref).
      const handler = mockSdkTool.mock.calls[0]![3] as (input: unknown) => Promise<{ content: { text: string }[] }>
      expect((await handler({})).content[0]!.text).toBe('two')
      await provider.close()
    })

    it('invalidates the session when prior messages are rewritten (e.g. compaction)', async () => {
      mockQuery.mockImplementation(persistentQueryMock([[resultMsg()], [resultMsg()]]))
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [
        { role: 'user', content: 'original' },
      ] }))
      // Simulate compaction: the first user message is rewritten.
      await collect(provider.stream({ model: 'x', messages: [
        { role: 'user', content: 'compacted summary' },
        { role: 'user', content: 'follow-up' },
      ] }))
      expect(mockQuery).toHaveBeenCalledTimes(2)
      await provider.close()
    })

    it('close() terminates the subprocess and the next stream() starts fresh', async () => {
      const closeCalls: number[] = []
      let idx = 0
      const orig = persistentQueryMock([[resultMsg()], [resultMsg()]])
      mockQuery.mockImplementation((params: { prompt: AsyncIterable<unknown>; options: unknown }) => {
        const inner = orig(params) as { close: () => void } & AsyncIterator<unknown, void>
        const origClose = inner.close.bind(inner)
        const instanceId = ++idx
        inner.close = () => { closeCalls.push(instanceId); origClose() }
        return inner
      })
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      await provider.close()
      expect(closeCalls).toEqual([1])
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      expect(mockQuery).toHaveBeenCalledTimes(2)
      await provider.close()
    })

    it('interrupts the session on abort but does not spawn a new subprocess until it is invalidated', async () => {
      let interrupts = 0
      let closes = 0
      mockQuery.mockImplementation(() => {
        let interrupted = false
        let resolveWait: (() => void) | undefined
        const wait = new Promise<void>(r => { resolveWait = r })
        const q = {
          next: async () => {
            if (interrupted) return { value: undefined, done: true }
            await wait
            return { value: resultMsg(), done: false }
          },
          interrupt: async () => { interrupts++; interrupted = true; resolveWait?.() },
          close: () => { closes++; interrupted = true; resolveWait?.() },
          [Symbol.asyncIterator]() { return this },
        }
        return q
      })

      const provider = new AnthropicAgentsSdkProvider()
      const ac = new AbortController()
      const streamPromise = collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'wait' }], signal: ac.signal }))
      await new Promise(r => setTimeout(r, 10))
      ac.abort()
      const chunks = await streamPromise as { type: string }[]
      expect(chunks.at(-1)?.type).toBe('done')
      expect(interrupts).toBeGreaterThanOrEqual(1)
      // Session is retired after interrupt → next call spawns a fresh process.
      expect(closes).toBeGreaterThanOrEqual(1)
      await provider.close()
    })
  })

  // ── chat() ────────────────────────────────────────────────────────

  describe('chat()', () => {
    it('collects text from stream into response (no tool calls surfaced)', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } }),
        resultMsg(),
      )
      const response = await new AnthropicAgentsSdkProvider().chat({ model: 'x', messages: [{ role: 'user', content: 'go' }] })
      expect(response.message.content).toBe('Done.')
      expect(response.message.toolCalls).toBeUndefined()
    })
  })
})

describe('registry', () => {
  it('creates via createProvider', async () => {
    const { createProvider } = await import('@chinmaymk/ra')
    expect(createProvider({ provider: 'anthropic-agents-sdk' }).name).toBe('anthropic-agents-sdk')
  })
})
