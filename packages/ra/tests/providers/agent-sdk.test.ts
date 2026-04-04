import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockQuery = mock()
const mockCreateSdkMcpServer = mock()
const mockSdkTool = mock()

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
  createSdkMcpServer: mockCreateSdkMcpServer,
  tool: mockSdkTool,
}))

import { AgentSdkProvider } from '@chinmaymk/ra'

describe('AgentSdkProvider', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockCreateSdkMcpServer.mockReset()
    mockSdkTool.mockReset()
    mockSdkTool.mockImplementation((_name: string, _desc: string, _schema: unknown, handler: unknown) => ({
      name: _name,
      description: _desc,
      inputSchema: _schema,
      handler,
    }))
    mockCreateSdkMcpServer.mockReturnValue({ type: 'sdk', instance: {} })
  })

  it('has correct provider name', () => {
    const provider = new AgentSdkProvider()
    expect(provider.name).toBe('agent-sdk')
  })

  describe('formatConversation', () => {
    it('returns plain text for a single user message', () => {
      const provider = new AgentSdkProvider()
      const result = provider.formatConversation([{ role: 'user', content: 'hello' }])
      expect(result).toBe('hello')
    })

    it('formats multi-turn conversation', () => {
      const provider = new AgentSdkProvider()
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
      const provider = new AgentSdkProvider()
      const result = provider.formatConversation([
        { role: 'user', content: 'read file.txt' },
        {
          role: 'assistant',
          content: 'Reading the file.',
          toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{"path":"file.txt"}' }],
        },
      ])
      expect(result).toContain('tool_call id="tc_1" name="Read"')
      expect(result).toContain('{"path":"file.txt"}')
    })

    it('formats tool results', () => {
      const provider = new AgentSdkProvider()
      const result = provider.formatConversation([
        { role: 'user', content: 'read it' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc_1', name: 'Read', arguments: '{}' }],
        },
        { role: 'tool', content: 'file contents', toolCallId: 'tc_1' },
      ])
      expect(result).toContain('[Tool Result id="tc_1"]')
      expect(result).toContain('file contents')
    })

    it('formats error tool results', () => {
      const provider = new AgentSdkProvider()
      const result = provider.formatConversation([
        { role: 'tool', content: 'not found', toolCallId: 'tc_1', isError: true },
      ])
      expect(result).toContain('error="true"')
    })

    it('returns empty string for empty messages', () => {
      const provider = new AgentSdkProvider()
      expect(provider.formatConversation([])).toBe('')
    })
  })

  describe('buildMcpServer', () => {
    it('creates MCP tools from ra tool definitions', () => {
      const provider = new AgentSdkProvider()
      const tools = [
        {
          name: 'Read',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
          execute: async () => '',
        },
      ]
      provider.buildMcpServer(tools)
      expect(mockSdkTool).toHaveBeenCalledTimes(1)
      expect(mockSdkTool.mock.calls[0]![0]).toBe('Read')
      expect(mockSdkTool.mock.calls[0]![1]).toBe('Read a file')
      expect(mockCreateSdkMcpServer).toHaveBeenCalledTimes(1)
    })

    it('creates MCP tools for multiple tools', () => {
      const provider = new AgentSdkProvider()
      const tools = [
        { name: 'Read', description: 'Read', inputSchema: {}, execute: async () => '' },
        { name: 'Write', description: 'Write', inputSchema: {}, execute: async () => '' },
      ]
      provider.buildMcpServer(tools)
      expect(mockSdkTool).toHaveBeenCalledTimes(2)
    })
  })

  describe('stream()', () => {
    it('yields text chunks from stream events', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's1', uuid: 'u1' }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
          parent_tool_use_id: null,
          uuid: 'u2',
          session_id: 's1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 10, output_tokens: 5 },
          uuid: 'u3',
          session_id: 's1',
        }
      })())

      const provider = new AgentSdkProvider()
      const chunks: unknown[] = []
      for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk)
      }
      expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
    })

    it('yields tool call chunks from stream events', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'Read' } },
          parent_tool_use_id: null,
          uuid: 'u1',
          session_id: 's1',
        }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"f.txt"}' } },
          parent_tool_use_id: null,
          uuid: 'u2',
          session_id: 's1',
        }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_stop', index: 0 },
          parent_tool_use_id: null,
          uuid: 'u3',
          session_id: 's1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 10, output_tokens: 5 },
          uuid: 'u4',
          session_id: 's1',
        }
      })())

      const provider = new AgentSdkProvider()
      const chunks: unknown[] = []
      for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'read f.txt' }] })) {
        chunks.push(chunk)
      }
      expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'Read' })
      expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"f.txt"}' })
      expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
    })

    it('yields thinking chunks', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think...' } },
          parent_tool_use_id: null,
          uuid: 'u1',
          session_id: 's1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 10, output_tokens: 5 },
          uuid: 'u2',
          session_id: 's1',
        }
      })())

      const provider = new AgentSdkProvider()
      const chunks: unknown[] = []
      for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'think' }] })) {
        chunks.push(chunk)
      }
      expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Let me think...' })
    })

    it('extracts usage from result message', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
          parent_tool_use_id: null,
          uuid: 'u1',
          session_id: 's1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 42, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
          uuid: 'u2',
          session_id: 's1',
        }
      })())

      const provider = new AgentSdkProvider()
      const chunks: any[] = []
      for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk)
      }
      const done = chunks.find(c => c.type === 'done')
      expect(done.usage.inputTokens).toBe(42 + 100 + 50)
      expect(done.usage.outputTokens).toBe(7)
      expect(done.usage.cacheReadTokens).toBe(100)
      expect(done.usage.cacheCreationTokens).toBe(50)
    })

    it('always yields done even when stream ends early', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield { type: 'system', subtype: 'init', session_id: 's1', uuid: 'u1' }
      })())

      const provider = new AgentSdkProvider()
      const chunks: unknown[] = []
      for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk)
      }
      expect(chunks.at(-1)).toMatchObject({ type: 'done' })
    })

    it('passes system prompt from messages', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 0, output_tokens: 0 },
          uuid: 'u1',
          session_id: 's1',
        }
      })())

      const provider = new AgentSdkProvider()
      const chunks: unknown[] = []
      for await (const chunk of provider.stream({
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'system', content: 'You are a pirate.' },
          { role: 'user', content: 'hi' },
        ],
      })) {
        chunks.push(chunk)
      }
      // Verify query was called with systemPrompt
      const opts = mockQuery.mock.calls[0]![0].options
      expect(opts.systemPrompt).toBe('You are a pirate.')
    })

    it('registers MCP tools when tools are provided', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 }, uuid: 'u1', session_id: 's1' }
      })())

      const provider = new AgentSdkProvider()
      const tools = [{ name: 'Read', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, execute: async () => '' }]
      const chunks: unknown[] = []
      for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }], tools })) {
        chunks.push(chunk)
      }
      const opts = mockQuery.mock.calls[0]![0].options
      expect(opts.mcpServers).toBeDefined()
      expect(opts.mcpServers['ra-tools']).toBeDefined()
    })

    it('sets maxTurns to 1', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 }, uuid: 'u1', session_id: 's1' }
      })())

      const provider = new AgentSdkProvider()
      for await (const _ of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
      expect(mockQuery.mock.calls[0]![0].options.maxTurns).toBe(1)
    })

    it('disables built-in tools', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 0, output_tokens: 0 }, uuid: 'u1', session_id: 's1' }
      })())

      const provider = new AgentSdkProvider()
      for await (const _ of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })) { /* drain */ }
      expect(mockQuery.mock.calls[0]![0].options.tools).toEqual([])
    })
  })

  describe('chat()', () => {
    it('collects streaming chunks into a ChatResponse', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello from chat' } },
          parent_tool_use_id: null,
          uuid: 'u1',
          session_id: 's1',
        }
        yield {
          type: 'result',
          subtype: 'success',
          usage: { input_tokens: 10, output_tokens: 5 },
          uuid: 'u2',
          session_id: 's1',
        }
      })())

      const provider = new AgentSdkProvider()
      const result = await provider.chat({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })
      expect(result.message.role).toBe('assistant')
      expect(result.message.content).toBe('Hello from chat')
      expect(result.usage?.inputTokens).toBe(10)
      expect(result.usage?.outputTokens).toBe(5)
    })

    it('collects tool calls from streaming', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield {
          type: 'stream_event',
          event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tc_1', name: 'Read' } },
          parent_tool_use_id: null, uuid: 'u1', session_id: 's1',
        }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt"}' } },
          parent_tool_use_id: null, uuid: 'u2', session_id: 's1',
        }
        yield {
          type: 'stream_event',
          event: { type: 'content_block_stop', index: 0 },
          parent_tool_use_id: null, uuid: 'u3', session_id: 's1',
        }
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5 }, uuid: 'u4', session_id: 's1' }
      })())

      const provider = new AgentSdkProvider()
      const result = await provider.chat({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'read' }] })
      expect(result.message.toolCalls).toHaveLength(1)
      expect(result.message.toolCalls![0]!.id).toBe('tc_1')
      expect(result.message.toolCalls![0]!.name).toBe('Read')
      expect(result.message.toolCalls![0]!.arguments).toBe('{"path":"a.txt"}')
    })
  })

  describe('fallback assistant message parsing', () => {
    it('extracts tool calls from complete assistant message when no stream events', async () => {
      mockQuery.mockReturnValue((async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Let me read' },
              { type: 'tool_use', id: 'tc_1', name: 'Read', input: { path: 'test.txt' } },
            ],
          },
          parent_tool_use_id: null,
          uuid: 'u1',
          session_id: 's1',
        }
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5 }, uuid: 'u2', session_id: 's1' }
      })())

      const provider = new AgentSdkProvider()
      const chunks: any[] = []
      for await (const chunk of provider.stream({ model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'hi' }] })) {
        chunks.push(chunk)
      }
      const starts = chunks.filter(c => c.type === 'tool_call_start')
      expect(starts).toHaveLength(1)
      expect(starts[0].id).toBe('tc_1')
      expect(starts[0].name).toBe('Read')
    })
  })
})

describe('registry', () => {
  it('creates agent-sdk provider via createProvider', async () => {
    const { createProvider } = await import('@chinmaymk/ra')
    const provider = createProvider({ provider: 'agent-sdk' })
    expect(provider.name).toBe('agent-sdk')
  })
})
