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
    it('enables session persistence for resume', async () => { expect((await getOptions()).persistSession).toBe(true) })
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
    it('sets maxTurns to 1', async () => { expect((await getOptions()).maxTurns).toBe(1) })
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
    it('always sets maxTurns to 1', () => {
      expect(new AnthropicAgentsSdkProvider().buildOptions({ model: 'x', messages: [] }).maxTurns).toBe(1)
    })
  })

  // ── formatConversation ─────────────────────────────────────────────

  describe('formatConversation', () => {
    const provider = new AnthropicAgentsSdkProvider()

    it('wraps single user message in XML for cache-stable prefix', () => {
      const result = provider.formatConversation([{ role: 'user', content: 'hello' }])
      expect(result).toBe('<user>\nhello\n</user>')
    })

    it('formats multi-turn with XML tags', () => {
      const result = provider.formatConversation([
        { role: 'user', content: 'read it' },
        { role: 'assistant', content: 'Sure.', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{"path":"f.txt"}' }] },
        { role: 'tool', content: 'file contents', toolCallId: 'tc_1' },
      ])
      expect(result).toContain('<user>')
      expect(result).toContain('</user>')
      expect(result).toContain('<assistant>')
      expect(result).toContain('</assistant>')
      expect(result).toContain('<tool_call id="tc_1" name="Read">')
      expect(result).toContain('<tool_result id="tc_1">')
      expect(result).toContain('</tool_result>')
      expect(result).toContain('file contents')
    })

    it('marks error tool results', () => {
      const result = provider.formatConversation([
        { role: 'tool', content: 'not found', toolCallId: 'tc_1', isError: true },
      ])
      expect(result).toContain('<tool_result id="tc_1" error="true">')
    })

    it('appends opening assistant tag when conversation ends with tool result', () => {
      const result = provider.formatConversation([
        { role: 'user', content: 'read it' },
        { role: 'assistant', content: 'Sure.', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{}' }] },
        { role: 'tool', content: 'contents', toolCallId: 'tc_1' },
      ])
      expect(result).toEndWith('\n\n<assistant>\n')
    })

    it('does not append assistant tag when conversation ends with user message', () => {
      const result = provider.formatConversation([{ role: 'user', content: 'hello' }])
      expect(result).not.toContain('<assistant>')
    })
  })

  // ── MCP tool schemas ─────────────────────────────────────────────

  describe('buildMcpToolSchemas', () => {
    it('registers tools with no-op handlers', async () => {
      new AnthropicAgentsSdkProvider().buildMcpToolSchemas([
        { name: 'read', description: 'read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, execute: async () => 'contents' },
      ])
      expect(mockSdkTool).toHaveBeenCalledTimes(1)
      expect(mockSdkTool.mock.calls[0]![0]).toBe('read')

      const handler = mockSdkTool.mock.calls[0]![3] as () => Promise<unknown>
      const result = await handler() as { content: { text: string }[] }
      expect(result.content[0]!.text).toBe('')
    })
  })

  // ── stream() ──────────────────────────────────────────────────────

  describe('stream()', () => {
    it('passes prompt as XML-wrapped string', async () => {
      mockQueryWith(resultMsg())
      await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }))
      const { prompt } = mockQuery.mock.calls[0]![0]
      expect(typeof prompt).toBe('string')
      expect(prompt).toBe('<user>\nhi\n</user>')
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

    it('yields tool_call_start/delta/end chunks for tool_use blocks', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_1', name: 'read_file' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"foo.txt"}' } }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'read foo' }] }))
      expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'read_file' })
      expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":' })
      expect(chunks[2]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '"foo.txt"}' })
      expect(chunks[3]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
    })

    it('strips mcp__ra-tools__ prefix from tool names', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'mcp__ra-tools__Read' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] })) as { type: string; name?: string }[]
      expect(chunks[0]!.name).toBe('Read')
    })

    it('handles interleaved text and tool calls', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me read that.' } }),
        streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_2', name: 'read' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        resultMsg(),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] })) as { type: string }[]
      const types = chunks.map(c => c.type)
      expect(types).toEqual(['text', 'tool_call_start', 'tool_call_delta', 'tool_call_end', 'done'])
    })

    it('extracts usage from modelUsage (preferred — has cache tokens)', async () => {
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

    // ── Session resume for tool results ─────────────────────────────

    it('resumes session on tool-result turns with structured messages', async () => {
      const provider = new AnthropicAgentsSdkProvider()

      // First call: fresh session — captures session_id
      mockQueryWith(
        streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'Read' } }),
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        resultMsg(),
      )
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'read it' }] }))
      const firstCallOptions = mockQuery.mock.calls[0]![0].options
      expect(firstCallOptions.resume).toBeUndefined()

      // Second call: tool-result turn — should resume with session_id 's'
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } }),
        resultMsg(),
      )
      await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'read it' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{}' }] },
          { role: 'tool', content: 'file contents', toolCallId: 'tc_1' },
        ],
      }))
      const secondCall = mockQuery.mock.calls[1]![0]
      expect(secondCall.options.resume).toBe('s')
      // Prompt should be an async iterable (not a string) for structured tool results
      expect(typeof secondCall.prompt).not.toBe('string')
    })

    it('sends tool results as structured content blocks during resume', async () => {
      const provider = new AnthropicAgentsSdkProvider()

      // First call to capture session
      mockQueryWith(resultMsg())
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] }))

      // Second call with tool results
      mockQueryWith(resultMsg())
      await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{}' }] },
          { role: 'tool', content: 'result data', toolCallId: 'tc_1' },
        ],
      }))

      const prompt = mockQuery.mock.calls[1]![0].prompt
      // Collect messages from the async iterable
      const messages: unknown[] = []
      for await (const m of prompt as AsyncIterable<unknown>) messages.push(m)
      expect(messages).toHaveLength(1)
      const msg = messages[0] as { type: string; message: { role: string; content: unknown[] }; parent_tool_use_id: string | null }
      expect(msg.type).toBe('user')
      expect(msg.parent_tool_use_id).toBeNull()
      expect(msg.message.role).toBe('user')
      const content = msg.message.content as { type: string; tool_use_id: string; content: string }[]
      expect(content).toHaveLength(1)
      expect(content[0]!.type).toBe('tool_result')
      expect(content[0]!.tool_use_id).toBe('tc_1')
      expect(content[0]!.content).toBe('result data')
    })

    it('falls back to XML when resume fails', async () => {
      const provider = new AnthropicAgentsSdkProvider()

      // First call to capture session
      mockQueryWith(resultMsg())
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] }))

      // Second call: resume fails (throw on first call), should fall back to XML
      let callCount = 0
      mockQuery.mockImplementation(() => {
        callCount++
        if (callCount === 1) throw new Error('session not found')
        return (async function* () { yield resultMsg() })()
      })
      const chunks = await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{}' }] },
          { role: 'tool', content: 'data', toolCallId: 'tc_1' },
        ],
      }))
      // Should have fallen back and returned a result
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
      // Two calls: resume attempt (threw) + fallback with XML
      expect(callCount).toBe(2)
      const fallbackCall = mockQuery.mock.calls[2]![0]
      expect(typeof fallbackCall.prompt).toBe('string')
      expect(fallbackCall.options.resume).toBeUndefined()
    })

    it('resets session on fresh user-only messages', async () => {
      const provider = new AnthropicAgentsSdkProvider()

      // First call to set session
      mockQueryWith(resultMsg())
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'first' }] }))

      // Second call: new user message (no trailing tool results) — should NOT resume
      mockQueryWith(resultMsg())
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'second' }] }))
      expect(mockQuery.mock.calls[1]![0].options.resume).toBeUndefined()
      expect(typeof mockQuery.mock.calls[1]![0].prompt).toBe('string')
    })

    it('marks error tool results with is_error during resume', async () => {
      const provider = new AnthropicAgentsSdkProvider()

      // First call to capture session
      mockQueryWith(resultMsg())
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] }))

      // Second call with error tool result
      mockQueryWith(resultMsg())
      await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{}' }] },
          { role: 'tool', content: 'file not found', toolCallId: 'tc_1', isError: true },
        ],
      }))

      const prompt = mockQuery.mock.calls[1]![0].prompt
      const messages: unknown[] = []
      for await (const m of prompt as AsyncIterable<unknown>) messages.push(m)
      const content = (messages[0] as { message: { content: unknown[] } }).message.content as { is_error?: boolean }[]
      expect(content[0]!.is_error).toBe(true)
    })

    it('handles multiple tool results in a single resume', async () => {
      const provider = new AnthropicAgentsSdkProvider()

      // First call
      mockQueryWith(resultMsg())
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] }))

      // Second call with multiple tool results
      mockQueryWith(resultMsg())
      await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: '', toolCalls: [
            { id: 'tc_1', name: 'Read', arguments: '{}' },
            { id: 'tc_2', name: 'Grep', arguments: '{}' },
          ] },
          { role: 'tool', content: 'file data', toolCallId: 'tc_1' },
          { role: 'tool', content: 'grep results', toolCallId: 'tc_2' },
        ],
      }))

      const prompt = mockQuery.mock.calls[1]![0].prompt
      const messages: unknown[] = []
      for await (const m of prompt as AsyncIterable<unknown>) messages.push(m)
      const content = (messages[0] as { message: { content: unknown[] } }).message.content as { tool_use_id: string }[]
      expect(content).toHaveLength(2)
      expect(content[0]!.tool_use_id).toBe('tc_1')
      expect(content[1]!.tool_use_id).toBe('tc_2')
    })

    it('resetSession() clears the session so next call is fresh', async () => {
      const provider = new AnthropicAgentsSdkProvider()

      // First call to set session
      mockQueryWith(resultMsg())
      await collect(provider.stream({ model: 'x', messages: [{ role: 'user', content: 'go' }] }))

      provider.resetSession()

      // Next call with tool results should NOT resume (session was reset)
      mockQueryWith(resultMsg())
      await collect(provider.stream({
        model: 'x',
        messages: [
          { role: 'user', content: 'go' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{}' }] },
          { role: 'tool', content: 'data', toolCallId: 'tc_1' },
        ],
      }))
      expect(mockQuery.mock.calls[1]![0].options.resume).toBeUndefined()
      expect(typeof mockQuery.mock.calls[1]![0].prompt).toBe('string')
    })
  })

  // ── chat() ────────────────────────────────────────────────────────

  describe('chat()', () => {
    it('collects tool calls from stream into response message', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Sure.' } }),
        streamEvent({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc_1', name: 'calc' } }),
        streamEvent({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        resultMsg(),
      )
      const response = await new AnthropicAgentsSdkProvider().chat({ model: 'x', messages: [{ role: 'user', content: 'go' }] })
      expect(response.message.content).toBe('Sure.')
      expect(response.message.toolCalls).toEqual([{ id: 'tc_1', name: 'calc', arguments: '{"x":1}' }])
    })
  })
})

describe('registry', () => {
  it('creates via createProvider', async () => {
    const { createProvider } = await import('@chinmaymk/ra')
    expect(createProvider({ provider: 'anthropic-agents-sdk' }).name).toBe('anthropic-agents-sdk')
  })
})
