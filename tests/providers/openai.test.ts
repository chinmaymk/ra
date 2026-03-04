import { describe, it, expect } from 'bun:test'
import { OpenAIProvider } from '../../src/providers/openai'

describe('OpenAIProvider', () => {
  it('has correct name', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    expect(provider.name).toBe('openai')
  })

  it('keeps system messages in array', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('system')
    expect(mapped).toHaveLength(2)
  })

  it('maps tools to OpenAI format', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = (provider as any).mapTools(tools)
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].function.name).toBe('test_tool')
  })

  it('maps tool messages with tool_call_id', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'result text', toolCallId: 'call_123' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('tool')
    expect(mapped[0].tool_call_id).toBe('call_123')
    expect(mapped[0].content).toBe('result text')
  })

  it('maps assistant messages with toolCalls to tool_calls array', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Let me call a tool',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('assistant')
    expect(mapped[0].content).toBe('Let me call a tool')
    expect(mapped[0].tool_calls).toHaveLength(1)
    expect(mapped[0].tool_calls[0].id).toBe('call_1')
    expect(mapped[0].tool_calls[0].type).toBe('function')
    expect(mapped[0].tool_calls[0].function.name).toBe('test_tool')
    expect(mapped[0].tool_calls[0].function.arguments).toBe('{"x":1}')
  })

  it('maps OpenAI response back to IMessage', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const openaiMsg = {
      role: 'assistant',
      content: 'Hello',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'test_tool', arguments: '{"x":1}' },
        },
      ],
    }
    const result = (provider as any).mapResponseToMessage(openaiMsg)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].id).toBe('call_1')
    expect(result.toolCalls[0].name).toBe('test_tool')
    expect(result.toolCalls[0].arguments).toBe('{"x":1}')
  })

  it('maps content parts correctly', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const parts = [
      { type: 'text' as const, text: 'hello' },
      { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc' } },
      { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.png' } },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0]).toEqual({ type: 'text', text: 'hello' })
    expect(mapped[1].type).toBe('image_url')
    expect(mapped[1].image_url.url).toBe('data:image/png;base64,abc')
    expect(mapped[2].type).toBe('image_url')
    expect(mapped[2].image_url.url).toBe('https://example.com/img.png')
  })

  it('maps response without tool_calls', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const openaiMsg = {
      role: 'assistant',
      content: 'Just text',
      tool_calls: undefined,
    }
    const result = (provider as any).mapResponseToMessage(openaiMsg)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Just text')
    expect(result.toolCalls).toBeUndefined()
  })
})

describe('thinking / reasoning effort', () => {
  it('adds reasoning effort to buildParams when thinking is set', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'medium',
    })
    expect(params.reasoning).toEqual({ effort: 'medium' })
  })

  it('does not add reasoning when thinking is not set', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = (provider as any).buildParams({
      model: 'gpt-4o',
      messages: [{ role: 'user' as const, content: 'hi' }],
    })
    expect(params.reasoning).toBeUndefined()
  })
})
