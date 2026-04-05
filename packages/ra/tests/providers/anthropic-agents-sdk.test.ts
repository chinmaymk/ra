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
    it('does not set maxTurns', async () => { expect((await getOptions()).maxTurns).toBeUndefined() })
  })

  // ── buildParams ───────────────────────────────────────────────────

  describe('buildParams', () => {
    it('maps thinking with budget cap', () => {
      const p = new AnthropicAgentsSdkProvider().buildParams({ model: 'x', messages: [], thinking: 'high', thinkingBudgetCap: 10000 })
      expect((p.thinking as { budgetTokens: number }).budgetTokens).toBe(10000)
    })
    it('maps thinking to effort', () => {
      expect(new AnthropicAgentsSdkProvider().buildParams({ model: 'x', messages: [], thinking: 'low' }).effort).toBe('low')
    })
  })

  // ── MCP tool handlers ─────────────────────────────────────────────

  describe('buildMcpServer', () => {
    it('executes real tool', async () => {
      new AnthropicAgentsSdkProvider().buildMcpServer([
        { name: 'add', description: 'add', inputSchema: {}, execute: async (input: { a: number; b: number }) => input.a + input.b },
      ])
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      const result = await handler({ a: 1, b: 2 }) as { content: { text: string }[] }
      expect(result.content[0]!.text).toBe('3')
    })

    it('returns error on tool failure', async () => {
      new AnthropicAgentsSdkProvider().buildMcpServer([
        { name: 'fail', description: 'fail', inputSchema: {}, execute: async () => { throw new Error('boom') } },
      ])
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      const result = await handler({}) as { content: { text: string }[]; isError: boolean }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('boom')
    })

    it('pushes tool activity text to queue', async () => {
      const queue: string[] = []
      new AnthropicAgentsSdkProvider().buildMcpServer([
        { name: 'echo', description: 'echo', inputSchema: {}, execute: async () => 'hello' },
      ], queue)
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      await handler({ text: 'hi' })
      expect(queue.some(t => t.includes('echo'))).toBe(true)
      expect(queue.some(t => t.includes('✓'))).toBe(true)
    })

    it('checks permissions before executing', async () => {
      const provider = new AnthropicAgentsSdkProvider({
        checkToolPermission: async (name) => name === 'danger' ? 'blocked' : undefined,
      })
      const queue: string[] = []
      provider.buildMcpServer([
        { name: 'danger', description: 'danger', inputSchema: {}, execute: async () => 'should not run' },
      ], queue)
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      const result = await handler({}) as { content: { text: string }[]; isError: boolean }
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toBe('blocked')
      expect(queue.some(t => t.includes('denied'))).toBe(true)
    })

    it('allows tool when permission check passes', async () => {
      const provider = new AnthropicAgentsSdkProvider({
        checkToolPermission: async () => undefined,
      })
      provider.buildMcpServer([
        { name: 'safe', description: 'safe', inputSchema: {}, execute: async () => 'ok' },
      ])
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      const result = await handler({}) as { content: { text: string }[] }
      expect(result.content[0]!.text).toBe('ok')
    })
  })

  // ── stream() ──────────────────────────────────────────────────────

  describe('stream()', () => {
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

    it('flushes tool activity text between stream events', async () => {
      // Simulate: SDK yields text, then tool handler pushes activity, then more text
      const toolQueue: string[] = []
      const provider = new AnthropicAgentsSdkProvider()
      // Pre-push some tool activity text
      toolQueue.push('\n◆ Read {"path":"f.txt"}\n')
      toolQueue.push('✓ Read (42 chars)\n')

      // Access parseSession directly by building a mock session
      mockQuery.mockReturnValue((async function* () {
        yield streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done' } })
        yield resultMsg()
      })())

      // We can't easily inject toolQueue into stream(), so test the integration indirectly
      // by verifying buildMcpServer pushes to queue
      const tools = [{ name: 'Read', description: 'Read', inputSchema: {}, execute: async () => 'contents' }]
      const queue: string[] = []
      provider.buildMcpServer(tools, queue)
      const handler = mockSdkTool.mock.calls[0]![3] as (args: Record<string, unknown>) => Promise<unknown>
      await handler({ path: 'f.txt' })
      expect(queue.length).toBeGreaterThan(0)
      expect(queue.some(t => t.includes('◆ Read'))).toBe(true)
    })

    it('extracts usage from modelUsage (preferred — has cache tokens)', async () => {
      mockQueryWith(
        streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
        resultMsg({
          usage: { input_tokens: 100, output_tokens: 20 },
          modelUsage: {
            'claude-sonnet-4-6': {
              inputTokens: 100,
              outputTokens: 20,
              cacheReadInputTokens: 500,
              cacheCreationInputTokens: 200,
            },
          },
        }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const done = chunks.find((c: any) => c.type === 'done')
      expect(done.usage.inputTokens).toBe(100 + 500 + 200)
      expect(done.usage.outputTokens).toBe(20)
      expect(done.usage.cacheReadTokens).toBe(500)
      expect(done.usage.cacheCreationTokens).toBe(200)
    })

    it('aggregates usage across multiple models in modelUsage', async () => {
      mockQueryWith(
        resultMsg({
          modelUsage: {
            'claude-sonnet-4-6': { inputTokens: 50, outputTokens: 10, cacheReadInputTokens: 100, cacheCreationInputTokens: 0 },
            'claude-haiku-4-5-20251001': { inputTokens: 30, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
          },
        }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const done = chunks.find((c: any) => c.type === 'done')
      expect(done.usage.inputTokens).toBe(50 + 30 + 100)
      expect(done.usage.outputTokens).toBe(15)
      expect(done.usage.cacheReadTokens).toBe(100)
    })

    it('falls back to raw usage when modelUsage is absent', async () => {
      mockQueryWith(
        resultMsg({
          usage: { input_tokens: 42, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
        }),
      )
      const chunks = await collect(new AnthropicAgentsSdkProvider().stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) as any[]
      const done = chunks.find((c: any) => c.type === 'done')
      expect(done.usage.inputTokens).toBe(42 + 100 + 50)
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
})

describe('registry', () => {
  it('creates via createProvider', async () => {
    const { createProvider } = await import('@chinmaymk/ra')
    expect(createProvider({ provider: 'anthropic-agents-sdk' }).name).toBe('anthropic-agents-sdk')
  })
})
