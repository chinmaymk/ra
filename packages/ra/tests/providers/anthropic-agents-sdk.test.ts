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

      const yielded: unknown[] = []
      for await (const m of prompt as AsyncIterable<unknown>) yielded.push(m)
      expect(yielded).toHaveLength(1)
      const msg = yielded[0] as { type: string; message: { role: string; content: string } }
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
