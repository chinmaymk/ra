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

/** Helper: create a mock query that yields the given SDK messages. */
function mockQueryWith(...messages: unknown[]) {
  mockQuery.mockReturnValue((async function* () {
    for (const msg of messages) yield msg
  })())
}

/** Shorthand for a stream_event wrapping a BetaRawMessageStreamEvent. */
function streamEvent(event: unknown) {
  return { type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: 's' }
}

/** Shorthand for a result message. */
function resultMsg(usage: Record<string, number> = { input_tokens: 0, output_tokens: 0 }) {
  return { type: 'result', subtype: 'success', usage, uuid: 'u', session_id: 's' }
}

/** Drain a stream into an array. */
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
    mockSdkTool.mockImplementation((_name: string, _desc: string, _schema: unknown, handler: unknown) => ({
      name: _name, description: _desc, inputSchema: _schema, handler,
    }))
    mockCreateSdkMcpServer.mockReturnValue({ type: 'sdk', instance: {} })
  })

  it('has correct provider name', () => {
    expect(new AnthropicAgentsSdkProvider().name).toBe('anthropic-agents-sdk')
  })

  // ── SDK magic disabled ────────────────────────────────────────────

  describe('SDK magic is disabled', () => {
    beforeEach(() => mockQueryWith(resultMsg()))

    async function getOptions(requestOverrides = {}) {
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], ...requestOverrides }))
      return mockQuery.mock.calls[0]![0].options
    }

    it('disables all setting sources (no CLAUDE.md loading)', async () => {
      const opts = await getOptions()
      expect(opts.settingSources).toEqual([])
    })

    it('disables session persistence', async () => {
      const opts = await getOptions()
      expect(opts.persistSession).toBe(false)
    })

    it('disables auto-memory and auto-dream', async () => {
      const opts = await getOptions()
      expect(opts.settings.autoMemoryEnabled).toBe(false)
      expect(opts.settings.autoDreamEnabled).toBe(false)
    })

    it('disables built-in tools', async () => {
      const opts = await getOptions()
      expect(opts.tools).toEqual([])
    })

    it('bypasses permissions', async () => {
      const opts = await getOptions()
      expect(opts.permissionMode).toBe('bypassPermissions')
      expect(opts.allowDangerouslySkipPermissions).toBe(true)
    })

    it('sets maxTurns to 1', async () => {
      const opts = await getOptions()
      expect(opts.maxTurns).toBe(1)
    })

    it('enables partial messages for streaming', async () => {
      const opts = await getOptions()
      expect(opts.includePartialMessages).toBe(true)
    })

    it('replaces system prompt entirely (string, not preset)', async () => {
      const opts = await getOptions({
        messages: [
          { role: 'system', content: 'You are a pirate.' },
          { role: 'user', content: 'hi' },
        ],
      })
      expect(opts.systemPrompt).toBe('You are a pirate.')
      expect(typeof opts.systemPrompt).toBe('string')
    })

    it('uses fallback system prompt when none provided', async () => {
      const opts = await getOptions()
      expect(opts.systemPrompt).toBe('You are a helpful AI assistant.')
    })
  })

  // ── buildParams ───────────────────────────────────────────────────

  describe('buildParams', () => {
    it('passes model from request', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const params = provider.buildParams({ model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }] })
      expect(params.model).toBe('claude-opus-4-6')
    })

    it('falls back to default model from constructor', () => {
      const provider = new AnthropicAgentsSdkProvider({ model: 'claude-haiku-4-5-20251001' })
      const params = provider.buildParams({ model: '', messages: [{ role: 'user', content: 'hi' }] })
      expect(params.model).toBe('claude-haiku-4-5-20251001')
    })

    it('maps thinking levels to budget tokens', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const low = provider.buildParams({ model: 'x', messages: [], thinking: 'low' })
      const med = provider.buildParams({ model: 'x', messages: [], thinking: 'medium' })
      const high = provider.buildParams({ model: 'x', messages: [], thinking: 'high' })
      expect((low.thinking as { budgetTokens: number }).budgetTokens).toBe(1024)
      expect((med.thinking as { budgetTokens: number }).budgetTokens).toBe(16000)
      expect((high.thinking as { budgetTokens: number }).budgetTokens).toBe(32000)
    })

    it('applies thinkingBudgetCap', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const params = provider.buildParams({ model: 'x', messages: [], thinking: 'high', thinkingBudgetCap: 10000 })
      expect((params.thinking as { budgetTokens: number }).budgetTokens).toBe(10000)
    })

    it('maps thinking to effort level', () => {
      const provider = new AnthropicAgentsSdkProvider()
      expect(provider.buildParams({ model: 'x', messages: [], thinking: 'low' }).effort).toBe('low')
      expect(provider.buildParams({ model: 'x', messages: [], thinking: 'high' }).effort).toBe('high')
    })

    it('omits thinking and effort when not set', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const params = provider.buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      expect(params.thinking).toBeUndefined()
      expect(params.effort).toBeUndefined()
    })

    it('allows providerOptions.maxTurns override', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const params = provider.buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }], providerOptions: { maxTurns: 5 } })
      expect(params.maxTurns).toBe(5)
    })

    it('registers MCP tools when tools are provided', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const tools = [{ name: 'Read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, execute: async () => '' }]
      const params = provider.buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools })
      expect(params.mcpServers).toBeDefined()
    })

    it('omits mcpServers when no tools', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const params = provider.buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      expect(params.mcpServers).toBeUndefined()
    })
  })

  // ── formatConversation ────────────────────────────────────────────

  describe('formatConversation', () => {
    it('returns plain text for a single user message', () => {
      const provider = new AnthropicAgentsSdkProvider()
      expect(provider.formatConversation([{ role: 'user', content: 'hello' }])).toBe('hello')
    })

    it('formats multi-turn conversation', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const result = provider.formatConversation([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello!' },
        { role: 'user', content: 'how are you?' },
      ])
      expect(result).toContain('[User]\nhi')
      expect(result).toContain('[Assistant]\nhello!')
      expect(result).toContain('[User]\nhow are you?')
    })

    it('formats tool calls in assistant messages', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const result = provider.formatConversation([
        { role: 'user', content: 'read file.txt' },
        { role: 'assistant', content: 'Reading.', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{"path":"file.txt"}' }] },
      ])
      expect(result).toContain('tool_call id="tc_1" name="Read"')
      expect(result).toContain('{"path":"file.txt"}')
    })

    it('formats tool results', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const result = provider.formatConversation([
        { role: 'tool', content: 'file contents', toolCallId: 'tc_1' },
      ])
      expect(result).toContain('[Tool Result id="tc_1"]')
      expect(result).toContain('file contents')
    })

    it('formats error tool results', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const result = provider.formatConversation([
        { role: 'tool', content: 'not found', toolCallId: 'tc_1', isError: true },
      ])
      expect(result).toContain('error="true"')
    })

    it('returns empty string for no messages', () => {
      expect(new AnthropicAgentsSdkProvider().formatConversation([])).toBe('')
    })

    it('describes image content parts as metadata', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const result = provider.formatConversation([
        { role: 'user', content: [
          { type: 'text', text: 'Look at this' },
          { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
        ] },
        { role: 'assistant', content: 'I see.' },
      ])
      expect(result).toContain('Look at this')
      expect(result).toContain('[Image: https://example.com/img.png]')
    })

    it('describes base64 image content parts', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const result = provider.formatConversation([
        { role: 'user', content: [
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'abc123' } },
        ] },
      ])
      expect(result).toContain('[Image: image/png (base64, 6 chars)]')
    })

    it('describes file content parts as metadata', () => {
      const provider = new AnthropicAgentsSdkProvider()
      const result = provider.formatConversation([
        { role: 'user', content: [
          { type: 'text', text: 'Check this PDF' },
          { type: 'file', mimeType: 'application/pdf', data: 'base64data' },
        ] },
      ])
      expect(result).toContain('[File: application/pdf]')
    })
  })

  // ── buildMcpServer ────────────────────────────────────────────────

  describe('buildMcpServer', () => {
    it('creates MCP tools from ra tool definitions', () => {
      const provider = new AnthropicAgentsSdkProvider()
      provider.buildMcpServer([
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, execute: async () => '' },
      ])
      expect(mockSdkTool).toHaveBeenCalledTimes(1)
      expect(mockSdkTool.mock.calls[0]![0]).toBe('Read')
      expect(mockSdkTool.mock.calls[0]![1]).toBe('Read a file')
      expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(1)
    })

    it('MCP tool handlers return deferred marker', async () => {
      const provider = new AnthropicAgentsSdkProvider()
      provider.buildMcpServer([
        { name: 'Read', description: 'Read', inputSchema: {}, execute: async () => '' },
      ])
      const handler = mockSdkTool.mock.calls[0]![3] as () => Promise<unknown>
      const result = await handler()
      expect(result).toEqual({ content: [{ type: 'text', text: '[tool execution deferred to ra]' }] })
    })
  })

  // ── stream() ──────────────────────────────────────────────────────

  describe('stream()', () => {
    it('yields text chunks from stream events', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
        resultMsg({ input_tokens: 10, output_tokens: 5 }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] }))
      expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
    })

    it('yields tool call chunks from stream events', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'Read' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"f.txt"}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'read' }] }))
      expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'Read' })
      expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"f.txt"}' })
      expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
    })

    it('yields thinking chunks', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'think' }] }))
      expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Let me think...' })
    })

    it('extracts usage from result message', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
        resultMsg({ input_tokens: 42, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const done = chunks.find(c => c.type === 'done')
      expect(done.usage.inputTokens).toBe(42 + 100 + 50)
      expect(done.usage.outputTokens).toBe(7)
      expect(done.usage.cacheReadTokens).toBe(100)
      expect(done.usage.cacheCreationTokens).toBe(50)
    })

    it('always yields done even when stream ends early', async () => {
      mockQueryWith({ type: 'system', subtype: 'init', session_id: 's', uuid: 'u' })
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
    })

    it('yields done immediately for pre-aborted signals', async () => {
      const controller = new AbortController()
      controller.abort()
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({
        model: 'x', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal,
      }))
      expect(chunks).toEqual([{ type: 'done' }])
    })

    it('ignores non-streaming SDK events (system, status, hooks)', async () => {
      mockQueryWith(
        { type: 'system', subtype: 'init', session_id: 's', uuid: 'u' },
        { type: 'status', status: 'connected', uuid: 'u', session_id: 's' },
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      // Only text + done, no system/status events leaked through
      expect(chunks.filter((c: any) => c.type === 'text')).toHaveLength(1)
      expect(chunks.filter((c: any) => c.type === 'done')).toHaveLength(1)
    })
  })

  // ── chat() ────────────────────────────────────────────────────────

  describe('chat()', () => {
    it('collects streaming chunks into a ChatResponse', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello from chat' } }),
        resultMsg({ input_tokens: 10, output_tokens: 5 }),
      )
      const result = await new AnthropicAgentsSdkProvider().chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      expect(result.message.role).toBe('assistant')
      expect(result.message.content).toBe('Hello from chat')
      expect(result.usage?.inputTokens).toBe(10)
      expect(result.usage?.outputTokens).toBe(5)
    })

    it('collects tool calls from streaming', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'Read' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt"}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      )
      const result = await new AnthropicAgentsSdkProvider().chat({ model: 'x', messages: [{ role: 'user', content: 'read' }] })
      expect(result.message.toolCalls).toHaveLength(1)
      expect(result.message.toolCalls![0]!.id).toBe('tc_1')
      expect(result.message.toolCalls![0]!.name).toBe('Read')
      expect(result.message.toolCalls![0]!.arguments).toBe('{"path":"a.txt"}')
    })
  })

  // ── Fallback assistant message parsing ────────────────────────────

  describe('fallback assistant message parsing', () => {
    it('extracts tool calls from complete assistant message when no stream events', async () => {
      mockQueryWith(
        {
          type: 'assistant',
          message: { content: [{ type: 'tool_use', id: 'tc_1', name: 'Read', input: { path: 'test.txt' } }] },
          parent_tool_use_id: null, uuid: 'u', session_id: 's',
        },
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const starts = chunks.filter((c: any) => c.type === 'tool_call_start')
      expect(starts).toHaveLength(1)
      expect(starts[0].id).toBe('tc_1')
      expect(starts[0].name).toBe('Read')
    })
  })
})

describe('registry', () => {
  it('creates anthropic-agents-sdk provider via createProvider', async () => {
    const { createProvider } = await import('@chinmaymk/ra')
    const provider = createProvider({ provider: 'anthropic-agents-sdk' })
    expect(provider.name).toBe('anthropic-agents-sdk')
  })
})
