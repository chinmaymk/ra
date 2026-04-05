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

/** Wrap a BetaRawMessageStreamEvent as an SDKPartialAssistantMessage. */
function streamEvent(event: unknown) {
  return { type: 'stream_event', event, parent_tool_use_id: null, uuid: 'u', session_id: 's' }
}

function resultMsg(usage: Record<string, number> = { input_tokens: 0, output_tokens: 0 }) {
  return { type: 'result', subtype: 'success', usage, uuid: 'u', session_id: 's' }
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

  describe('context isolation — ra owns all context engineering', () => {
    beforeEach(() => mockQueryWith(resultMsg()))

    async function getOptions(overrides = {}) {
      const provider = new AnthropicAgentsSdkProvider()
      await collect(provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], ...overrides }))
      return mockQuery.mock.calls[0]![0].options
    }

    it('disables all setting sources (no CLAUDE.md loading)', async () => {
      expect((await getOptions()).settingSources).toEqual([])
    })

    it('disables session persistence', async () => {
      expect((await getOptions()).persistSession).toBe(false)
    })

    it('disables auto-memory and auto-dream', async () => {
      const opts = await getOptions()
      expect(opts.settings.autoMemoryEnabled).toBe(false)
      expect(opts.settings.autoDreamEnabled).toBe(false)
    })

    it('disables git instructions and gitignore reading', async () => {
      const opts = await getOptions()
      expect(opts.settings.includeGitInstructions).toBe(false)
      expect(opts.settings.respectGitignore).toBe(false)
    })

    it('disables file checkpointing', async () => {
      expect((await getOptions()).enableFileCheckpointing).toBe(false)
    })

    it('disables plugins', async () => {
      expect((await getOptions()).plugins).toEqual([])
    })

    it('disables built-in tools', async () => {
      expect((await getOptions()).tools).toEqual([])
    })

    it('bypasses permissions', async () => {
      const opts = await getOptions()
      expect(opts.permissionMode).toBe('bypassPermissions')
      expect(opts.allowDangerouslySkipPermissions).toBe(true)
    })

    it('replaces system prompt entirely (string, not preset)', async () => {
      const opts = await getOptions({
        messages: [{ role: 'system', content: 'You are a pirate.' }, { role: 'user', content: 'hi' }],
      })
      expect(opts.systemPrompt).toBe('You are a pirate.')
    })

    it('uses fallback system prompt when none provided', async () => {
      expect((await getOptions()).systemPrompt).toBe('You are a helpful AI assistant.')
    })

    it('does not set maxTurns — no artificial limits', async () => {
      expect((await getOptions()).maxTurns).toBeUndefined()
    })
  })

  // ── buildParams ───────────────────────────────────────────────────

  describe('buildParams', () => {
    it('passes model from request', () => {
      const params = new AnthropicAgentsSdkProvider().buildParams({ model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }] })
      expect(params.model).toBe('claude-opus-4-6')
    })

    it('falls back to constructor model', () => {
      const params = new AnthropicAgentsSdkProvider({ model: 'claude-haiku-4-5-20251001' }).buildParams({ model: '', messages: [{ role: 'user', content: 'hi' }] })
      expect(params.model).toBe('claude-haiku-4-5-20251001')
    })

    it('maps thinking levels to budget tokens', () => {
      const p = new AnthropicAgentsSdkProvider()
      expect((p.buildParams({ model: 'x', messages: [], thinking: 'low' }).thinking as { budgetTokens: number }).budgetTokens).toBe(1024)
      expect((p.buildParams({ model: 'x', messages: [], thinking: 'high' }).thinking as { budgetTokens: number }).budgetTokens).toBe(32000)
    })

    it('applies thinkingBudgetCap', () => {
      const params = new AnthropicAgentsSdkProvider().buildParams({ model: 'x', messages: [], thinking: 'high', thinkingBudgetCap: 10000 })
      expect((params.thinking as { budgetTokens: number }).budgetTokens).toBe(10000)
    })

    it('maps thinking to effort level', () => {
      const p = new AnthropicAgentsSdkProvider()
      expect(p.buildParams({ model: 'x', messages: [], thinking: 'low' }).effort).toBe('low')
      expect(p.buildParams({ model: 'x', messages: [], thinking: 'high' }).effort).toBe('high')
    })
  })

  // ── formatConversation ────────────────────────────────────────────

  describe('formatConversation', () => {
    it('returns plain text for a single user message', () => {
      expect(new AnthropicAgentsSdkProvider().formatConversation([{ role: 'user', content: 'hello' }])).toBe('hello')
    })

    it('formats multi-turn conversation', () => {
      const r = new AnthropicAgentsSdkProvider().formatConversation([
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello!' },
        { role: 'user', content: 'how are you?' },
      ])
      expect(r).toContain('[User]\nhi')
      expect(r).toContain('[Assistant]\nhello!')
    })

    it('formats tool calls and results', () => {
      const r = new AnthropicAgentsSdkProvider().formatConversation([
        { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{"path":"f.txt"}' }] },
        { role: 'tool', content: 'file contents', toolCallId: 'tc_1' },
      ])
      expect(r).toContain('tool_call id="tc_1" name="Read"')
      expect(r).toContain('[Tool Result id="tc_1"]')
    })

    it('describes image and file content parts as metadata', () => {
      const r = new AnthropicAgentsSdkProvider().formatConversation([
        { role: 'user', content: [
          { type: 'text', text: 'Look' },
          { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
          { type: 'file', mimeType: 'application/pdf', data: 'abc' },
        ] },
      ])
      expect(r).toContain('[Image: https://example.com/img.png]')
      expect(r).toContain('[File: application/pdf]')
    })
  })

  // ── buildMcpServer — real tool execution ──────────────────────────

  describe('buildMcpServer', () => {
    it('creates MCP tools from ra tool definitions', () => {
      new AnthropicAgentsSdkProvider().buildMcpServer([
        { name: 'Read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, execute: async () => '' },
      ])
      expect(mockSdkTool).toHaveBeenCalledTimes(1)
      expect(mockSdkTool.mock.calls[0]![0]).toBe('Read')
      expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(1)
    })

    it('MCP handler executes the real tool', async () => {
      new AnthropicAgentsSdkProvider().buildMcpServer([
        { name: 'add', description: 'add', inputSchema: {}, execute: async (input: { a: number; b: number }) => input.a + input.b },
      ])
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      const result = await handler({ a: 1, b: 2 }) as { content: { text: string }[] }
      expect(result.content[0]!.text).toBe('3')
    })

    it('MCP handler returns error on tool failure', async () => {
      new AnthropicAgentsSdkProvider().buildMcpServer([
        { name: 'fail', description: 'fail', inputSchema: {}, execute: async () => { throw new Error('boom') } },
      ])
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      const result = await handler({}) as { content: { text: string }[]; isError: boolean }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('boom')
    })
  })

  // ── stream() ──────────────────────────────────────────────────────

  describe('stream()', () => {
    it('yields text chunks from stream events', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
    })

    it('yields thinking chunks', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Hmm...' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'think' }] }))
      expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Hmm...' })
    })

    it('does NOT yield tool_call chunks — SDK handles tools via MCP', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'Read' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"f"}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Done' } }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'read' }] })) as { type: string }[]
      // No tool_call_start/delta/end — only text + done
      expect(chunks.filter(c => c.type.startsWith('tool_call'))).toHaveLength(0)
      expect(chunks.filter(c => c.type === 'text')).toHaveLength(1)
    })

    it('extracts usage from result message', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
        resultMsg({ input_tokens: 42, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const done = chunks.find(c => c.type === 'done')
      expect(done.usage.inputTokens).toBe(42 + 100 + 50)
      expect(done.usage.cacheReadTokens).toBe(100)
    })

    it('always yields done even when stream ends early', async () => {
      mockQueryWith({ type: 'system', subtype: 'init', session_id: 's', uuid: 'u' })
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
    })

    it('yields done immediately for pre-aborted signals', async () => {
      const controller = new AbortController()
      controller.abort()
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], signal: controller.signal }))
      expect(chunks).toEqual([{ type: 'done' }])
    })

    it('registers MCP tools when tools are provided', async () => {
      mockQueryWith(resultMsg())
      const tools = [{ name: 'Read', description: 'Read', inputSchema: {}, execute: async () => '' }]
      await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools }))
      const opts = mockQuery.mock.calls[0]![0].options
      expect(opts.mcpServers).toBeDefined()
      expect(opts.mcpServers['ra-tools']).toBeDefined()
    })
  })

  // ── chat() ────────────────────────────────────────────────────────

  describe('chat()', () => {
    it('collects text into a ChatResponse', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
        resultMsg({ input_tokens: 10, output_tokens: 5 }),
      )
      const result = await new AnthropicAgentsSdkProvider().chat({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
      expect(result.message.content).toBe('Hello')
      expect(result.usage?.inputTokens).toBe(10)
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
