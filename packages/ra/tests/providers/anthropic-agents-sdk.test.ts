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
    it('enables session persistence so we can resume across subprocess restarts', async () => { expect((await getOptions()).persistSession).toBe(true) })
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

  // ── toSdkUserMessage ──────────────────────────────────────────────

  describe('toSdkUserMessage', () => {
    const provider = new AnthropicAgentsSdkProvider()

    it('passes plain text through as a string content', () => {
      const msg = provider.toSdkUserMessage({ role: 'user', content: 'hi' })
      expect(msg.type).toBe('user')
      expect(msg.message.role).toBe('user')
      expect(msg.message.content).toBe('hi')
      expect(msg.parent_tool_use_id).toBeNull()
    })

    it('preserves image attachments as native image blocks', () => {
      const msg = provider.toSdkUserMessage({
        role: 'user',
        content: [
          { type: 'text', text: 'see this' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc' } },
        ],
      })
      const content = msg.message.content as Array<{ type: string }>
      expect(Array.isArray(content)).toBe(true)
      expect(content[0]!.type).toBe('text')
      expect(content[1]!.type).toBe('image')
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
    it('pushes the new user message into the persistent prompt channel', async () => {
      mockQueryWith(resultMsg())
      await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      const { prompt } = mockQuery.mock.calls[0]![0]
      expect(prompt[Symbol.asyncIterator]).toBeDefined()

      // Pull one message from the inbox without draining — the channel
      // stays open across turns so `for await … of prompt` would hang.
      const iterator = (prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]()
      const first = await iterator.next()
      expect(first.done).toBe(false)
      const msg = first.value as { type: string; message: { role: string; content: string } }
      expect(msg.type).toBe('user')
      expect(msg.message.content).toBe('hi')
    })

    it('reuses a single subprocess across multiple turns', async () => {
      // First turn yields a text delta then a result; after the result the SDK
      // stays paused — second turn continues from the same generator, yielding
      // a second text delta and a second result.
      mockQuery.mockReturnValueOnce((async function* () {
        yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'one' } })
        yield resultMsg()
        yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'two' } })
        yield resultMsg()
      })())

      const provider = new AnthropicAgentsSdkProvider()
      const first = await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as { type: string; delta?: string }[]
      const second = await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'one' },
          { role: 'user', content: 'again' },
        ],
      })) as { type: string; delta?: string }[]

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(first.filter(c => c.type === 'text')).toEqual([{ type: 'text', delta: 'one' }])
      expect(second.filter(c => c.type === 'text')).toEqual([{ type: 'text', delta: 'two' }])
    })

    it('restarts the subprocess when history shrinks (compaction / reset)', async () => {
      mockQuery.mockReturnValueOnce((async function* () { yield resultMsg() })())
      mockQuery.mockReturnValueOnce((async function* () { yield resultMsg() })())

      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'one' },
          { role: 'assistant', content: 'ok' },
          { role: 'user', content: 'two' },
        ],
      }))
      // Caller compacts history to just the latest turn — persistent SDK
      // state has diverged, so we must restart.
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'fresh' }] }))

      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('throws when a turn has no new user or tool input', async () => {
      mockQuery.mockReturnValueOnce((async function* () { yield resultMsg() })())
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      // Same history, no new input — would hang the SDK forever.
      await expect(
        collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })),
      ).rejects.toThrow(/no new user\/tool messages/)
    })

    it('forwards tool result messages as native tool_result content blocks', async () => {
      mockQuery.mockReturnValueOnce((async function* () {
        yield resultMsg()
        yield resultMsg()
      })())
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] }))
      await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: 'thinking…' },
          { role: 'tool', content: 'file contents here', toolCallId: 'tc_1', isError: true },
        ],
      }))

      const prompt = mockQuery.mock.calls[0]![0].prompt as AsyncIterable<{ message: { content: unknown } }>
      const iter = prompt[Symbol.asyncIterator]()
      const first = (await iter.next()).value
      const second = (await iter.next()).value
      expect(first.message.content).toBe('go')
      expect(Array.isArray(second.message.content)).toBe(true)
      const block = (second.message.content as Array<Record<string, unknown>>)[0]!
      expect(block.type).toBe('tool_result')
      expect(block.tool_use_id).toBe('tc_1')
      expect(block.content).toBe('file contents here')
      expect(block.is_error).toBe(true)
    })

    it('restarts the subprocess when the system prompt or tools change', async () => {
      mockQuery.mockReturnValueOnce((async function* () { yield resultMsg() })())
      mockQuery.mockReturnValueOnce((async function* () { yield resultMsg() })())

      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'x', messages: [{ role: 'system', content: 'A' }, { role: 'user', content: 'hi' }] }))
      await collect(provider.stream({ model: 'x', messages: [{ role: 'system', content: 'B' }, { role: 'user', content: 'hi' }] }))

      expect(mockQuery).toHaveBeenCalledTimes(2)
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

    it('seeds resumeSessionId from constructor options and passes it as resume', async () => {
      mockQueryWith(resultMsg())
      const provider = new AnthropicAgentsSdkProvider({ resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' })
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      const opts = mockQuery.mock.calls[0]![0].options
      expect(opts.resume).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    })

    it('calls onSessionId when init event contains session_id', async () => {
      const captured: string[] = []
      mockQueryWith(
        { type: 'system', subtype: 'init', session_id: 'cc-uuid-1234', uuid: 'u' },
        resultMsg(),
      )
      const provider = new AnthropicAgentsSdkProvider({ onSessionId: (id) => captured.push(id) })
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      expect(captured).toEqual(['cc-uuid-1234'])
    })

    it('uses constructor resumeSessionId over request.sessionId', async () => {
      mockQueryWith(resultMsg())
      const provider = new AnthropicAgentsSdkProvider({ resumeSessionId: 'from-constructor' })
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], sessionId: 'from-request' }))
      const opts = mockQuery.mock.calls[0]![0].options
      expect(opts.resume).toBe('from-constructor')
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
