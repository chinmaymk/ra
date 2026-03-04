import { describe, it, expect } from 'bun:test'
import { AnthropicProvider } from '../../src/providers/anthropic'
import { extractSystemMessages } from '../../src/providers/utils'

describe('AnthropicProvider', () => {
  it('has correct name', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    expect(provider.name).toBe('anthropic')
  })

  it('extracts system messages from message array', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { system, filtered } = extractSystemMessages(messages)
    expect(system).toBe('You are helpful')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.role).toBe('user')
  })

  it('maps tools to Anthropic format', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = (provider as any).mapTools(tools)
    expect(mapped[0].name).toBe('test_tool')
    expect(mapped[0].input_schema).toBeDefined()
  })

  it('maps tool messages to user messages with tool_result content', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'result text', toolCallId: 'call_123' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].content[0].type).toBe('tool_result')
    expect(mapped[0].content[0].tool_use_id).toBe('call_123')
    expect(mapped[0].content[0].content).toBe('result text')
  })

  it('handles malformed JSON in toolCall arguments gracefully', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: 'calling tool',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: 'not-valid-json{{{' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    const toolUse = mapped[0].content.find((b: any) => b.type === 'tool_use')
    expect(toolUse).toBeDefined()
    expect(toolUse.input).toEqual({})
  })

  it('maps assistant messages with toolCalls to tool_use blocks', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Let me call a tool',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('assistant')
    const content = mapped[0].content as any[]
    expect(content.some((b: any) => b.type === 'text')).toBe(true)
    expect(content.some((b: any) => b.type === 'tool_use')).toBe(true)
    const toolUse = content.find((b: any) => b.type === 'tool_use')
    expect(toolUse.id).toBe('call_1')
    expect(toolUse.name).toBe('test_tool')
    expect(toolUse.input).toEqual({ x: 1 })
  })

  it('maps Anthropic response back to IMessage', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const anthropicMsg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'tool_use', id: 'call_1', name: 'test_tool', input: { x: 1 } },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    }
    const result = (provider as any).mapResponseToMessage(anthropicMsg)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].id).toBe('call_1')
    expect(result.toolCalls[0].name).toBe('test_tool')
    expect(result.toolCalls[0].arguments).toBe('{"x":1}')
  })

  it('maps content parts correctly', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const parts = [
      { type: 'text' as const, text: 'hello' },
      { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc' } },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0]).toEqual({ type: 'text', text: 'hello' })
    expect(mapped[1].type).toBe('image')
    expect(mapped[1].source.type).toBe('base64')
    expect(mapped[1].source.media_type).toBe('image/png')
  })

  it('maps URL image content parts', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const parts = [
      { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.png' } },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].type).toBe('image')
    expect(mapped[0].source.type).toBe('url')
    expect(mapped[0].source.url).toBe('https://example.com/img.png')
  })

  it('maps file/document content parts to base64 document', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: 'base64pdfdata' },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].type).toBe('document')
    expect(mapped[0].source.type).toBe('base64')
    expect(mapped[0].source.media_type).toBe('application/pdf')
  })

  it('maps file content parts with Buffer data', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: Buffer.from('pdfdata') },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].type).toBe('document')
    expect(mapped[0].source.data).toBe(Buffer.from('pdfdata').toString('base64'))
  })

  it('buildParams includes tools when provided', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const tools = [{ name: 'test', description: 'test', inputSchema: {}, execute: async () => ({}) }]
    const params = (provider as any).buildParams({
      model: 'claude-3',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
    })
    expect(params.tools).toBeDefined()
    expect(params.tools).toHaveLength(1)
  })

  it('buildParams omits tools when not provided', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({
      model: 'claude-3',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.tools).toBeUndefined()
  })

  it('buildParams uses providerOptions maxTokens', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({
      model: 'claude-3',
      messages: [{ role: 'user', content: 'hi' }],
      providerOptions: { maxTokens: 8192 },
    })
    expect(params.max_tokens).toBe(8192)
  })

  it('buildParams defaults maxTokens to 4096', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({
      model: 'claude-3',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.max_tokens).toBe(4096)
  })

  it('maps assistant message with array content and toolCalls', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'looking at this' }],
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('assistant')
    expect(mapped[0].content.some((b: any) => b.type === 'text')).toBe(true)
    expect(mapped[0].content.some((b: any) => b.type === 'tool_use')).toBe(true)
  })

  it('maps user message with array content', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'hello' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].content[0].type).toBe('text')
  })

  it('maps response with only text (no tool_use)', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const response = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Just text' }],
      usage: { input_tokens: 5, output_tokens: 3 },
    }
    const result = (provider as any).mapResponseToMessage(response)
    expect(result.content).toBe('Just text')
    expect(result.toolCalls).toBeUndefined()
  })
})

describe('AnthropicProvider - chat()', () => {
  it('calls client and returns mapped response with usage', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      messages: {
        create: async () => ({
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from chat' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
    }
    const result = await provider.chat({
      model: 'claude-3',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toBe('Hello from chat')
    expect(result.usage?.inputTokens).toBe(10)
    expect(result.usage?.outputTokens).toBe(5)
  })
})

describe('AnthropicProvider - stream()', () => {
  it('yields text deltas from content_block_delta events', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      messages: {
        create: async () => (async function* () {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
          yield { type: 'message_delta', usage: { input_tokens: 10, output_tokens: 5 } }
          yield { type: 'message_stop' }
        })(),
      },
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1].type).toBe('done')
    expect(chunks[1].usage).toBeDefined()
  })

  it('yields tool_call_start from content_block_start with tool_use', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      messages: {
        create: async () => (async function* () {
          yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tc_1', name: 'read_file' } }
          yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":' } }
          yield { type: 'message_delta', usage: { input_tokens: 10, output_tokens: 5 } }
          yield { type: 'message_stop' }
        })(),
      },
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'read_file' })
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":' })
  })

  it('yields thinking deltas from thinking_delta events', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      messages: {
        create: async () => (async function* () {
          yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think...' } }
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } }
          yield { type: 'message_delta', usage: { input_tokens: 0, output_tokens: 10 } }
          yield { type: 'message_stop' }
        })(),
      },
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Let me think...' })
    expect(chunks[1]).toEqual({ type: 'text', delta: 'Answer' })
  })
})

describe('thinking', () => {
  it('includes thinking param in buildParams when thinking is set', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const request = {
      model: 'claude-3-7-sonnet-20250219',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'medium' as const,
    }
    const params = (provider as any).buildParams(request)
    expect(params.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })
  })

  it('does not include thinking when not set', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const request = { model: 'claude-3-7-sonnet-20250219', messages: [{ role: 'user' as const, content: 'hi' }] }
    const params = (provider as any).buildParams(request)
    expect(params.thinking).toBeUndefined()
  })

  it('maps low to 1000 tokens', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({ model: 'x', messages: [], thinking: 'low' })
    expect(params.thinking.budget_tokens).toBe(1000)
  })

  it('maps high to 32000 tokens', () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({ model: 'x', messages: [], thinking: 'high' })
    expect(params.thinking.budget_tokens).toBe(32000)
  })
})

describe('AnthropicProvider - stream() input token tracking', () => {
  it('captures inputTokens from message_start, not message_delta', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      messages: {
        create: async () => (async function* () {
          yield { type: 'message_start', message: { usage: { input_tokens: 42 } } }
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }
          yield { type: 'message_delta', usage: { output_tokens: 7 } }
          yield { type: 'message_stop' }
        })(),
      },
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    const done = chunks.find(c => c.type === 'done')
    expect(done.usage.inputTokens).toBe(42)
    expect(done.usage.outputTokens).toBe(7)
  })

  it('defaults inputTokens to 0 when message_start has no usage', async () => {
    const provider = new AnthropicProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      messages: {
        create: async () => (async function* () {
          yield { type: 'message_start', message: {} }
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }
          yield { type: 'message_delta', usage: { output_tokens: 3 } }
          yield { type: 'message_stop' }
        })(),
      },
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    const done = chunks.find(c => c.type === 'done')
    expect(done.usage.inputTokens).toBe(0)
    expect(done.usage.outputTokens).toBe(3)
  })
})
