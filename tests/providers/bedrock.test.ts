import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockClientSend = mock()

mock.module('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class MockBedrockRuntimeClient {
    send = mockClientSend
  },
  ConverseCommand: class ConverseCommand { constructor(public input: any) {} },
  ConverseStreamCommand: class ConverseStreamCommand { constructor(public input: any) {} },
}))

import { BedrockProvider } from '../../src/providers/bedrock'

describe('BedrockProvider', () => {
  const provider = new BedrockProvider({})

  it('maps tool result message to user role with toolResult block', () => {
    const messages = [{ role: 'tool' as const, content: 'tool output', toolCallId: 'call_abc' }]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].content[0].toolResult.toolUseId).toBe('call_abc')
    expect(mapped[0].content[0].toolResult.content[0].text).toBe('tool output')
  })

  it('handles malformed JSON in toolCall arguments gracefully', () => {
    const messages = [{
      role: 'assistant' as const,
      content: 'calling tool',
      toolCalls: [{ id: 'call_1', name: 'my_tool', arguments: 'not{valid' }],
    }]
    const mapped = provider.mapMessages(messages) as any[]
    const toolBlock = mapped[0].content.find((b: any) => b.toolUse)
    expect(toolBlock!.toolUse.input).toEqual({})
  })

  it('maps assistant with toolCalls to toolUse blocks alongside text', () => {
    const messages = [{
      role: 'assistant' as const,
      content: 'calling tool',
      toolCalls: [{ id: 'call_1', name: 'my_tool', arguments: '{"x":42}' }],
    }]
    const mapped = provider.mapMessages(messages) as any[]
    const content = mapped[0].content as any[]
    const textBlock = content.find((b: any) => b.text)
    const toolBlock = content.find((b: any) => b.toolUse)
    expect(textBlock.text).toBe('calling tool')
    expect(toolBlock.toolUse.toolUseId).toBe('call_1')
    expect(toolBlock.toolUse.name).toBe('my_tool')
    expect(toolBlock.toolUse.input).toEqual({ x: 42 })
  })

  it('omits empty text block when assistant has toolCalls but no content', () => {
    const messages = [{
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'call_2', name: 'other_tool', arguments: '{}' }],
    }]
    const mapped = provider.mapMessages(messages) as any[]
    const content = mapped[0].content as any[]
    expect(content.find((b: any) => b.toolUse)).toBeDefined()
    expect(content.some((b: any) => b.text === '')).toBe(false)
  })

  it('maps tools to Bedrock toolSpec format with inputSchema.json', () => {
    const tools = [{
      name: 'search',
      description: 'Search the web',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      execute: async () => ({}),
    }]
    const mapped = provider.mapTools(tools) as any[]
    expect(mapped[0].toolSpec.name).toBe('search')
    expect(mapped[0].toolSpec.description).toBe('Search the web')
    expect(mapped[0].toolSpec.inputSchema.json).toEqual(tools[0]!.inputSchema)
  })

  it('maps base64 image, extracting format from mediaType', () => {
    const parts = [{
      type: 'image' as const,
      source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc123' },
    }]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].image.format).toBe('png')
  })

  it('normalizes image/jpg mediaType to jpeg format for Bedrock', () => {
    const parts = [{
      type: 'image' as const,
      source: { type: 'base64' as const, mediaType: 'image/jpg', data: 'abc123' },
    }]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].image.format).toBe('jpeg')
  })

  it('falls back to text for URL images (not natively supported)', () => {
    const parts = [{
      type: 'image' as const,
      source: { type: 'url' as const, url: 'https://example.com/img.jpg' },
    }]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].text).toContain('https://example.com/img.jpg')
  })

  it('maps toolUse response to IMessage with serialized arguments', () => {
    const bedrockMsg = {
      role: 'assistant',
      content: [
        { text: 'Using tool' },
        { toolUse: { toolUseId: 'call_1', name: 'my_tool', input: { q: 'test' } } },
      ],
    }
    const result = provider.mapResponseToMessage(bedrockMsg as any)
    expect(result.content).toBe('Using tool')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.id).toBe('call_1')
    expect(result.toolCalls![0]!.arguments).toBe('{"q":"test"}')
  })

  it('handles undefined response message gracefully', () => {
    const result = provider.mapResponseToMessage(undefined)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('')
  })
})

describe('thinking', () => {
  it('includes additionalModelRequestFields when thinking is set', () => {
    const provider = new BedrockProvider({})
    const params = provider.buildParams({
      model: 'anthropic.claude-3-7-sonnet',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'high',
    })
    expect(params.additionalModelRequestFields).toEqual({
      thinking: { type: 'enabled', budget_tokens: 32000 }
    })
  })

  it('does not include additionalModelRequestFields when thinking is not set', () => {
    const provider = new BedrockProvider({})
    const params = provider.buildParams({ model: 'x', messages: [] })
    expect(params.additionalModelRequestFields).toBeUndefined()
  })

  it('maps low thinking to 1000 tokens', () => {
    const provider = new BedrockProvider({})
    const params = provider.buildParams({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: 'low',
    })
    expect((params as any).additionalModelRequestFields.thinking.budget_tokens).toBe(1000)
  })
})

describe('BedrockProvider - buildParams branches', () => {
  it('includes system text when system messages present', () => {
    const provider = new BedrockProvider({})
    const params = provider.buildParams({
      model: 'x',
      messages: [
        { role: 'system', content: 'Be helpful' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect((params as any).system).toBeDefined()
    expect((params as any).system[0].text).toBe('Be helpful')
  })

  it('includes toolConfig when tools provided', () => {
    const provider = new BedrockProvider({})
    const tools = [{ name: 'tool', description: 'desc', inputSchema: {}, execute: async () => ({}) }]
    const params = provider.buildParams({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
    })
    expect((params as any).toolConfig).toBeDefined()
    expect((params as any).toolConfig.tools).toHaveLength(1)
  })

  it('uses providerOptions maxTokens', () => {
    const provider = new BedrockProvider({})
    const params = provider.buildParams({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
      providerOptions: { maxTokens: 8192 },
    })
    expect(params.inferenceConfig.maxTokens).toBe(8192)
  })

  it('defaults maxTokens to 4096', () => {
    const provider = new BedrockProvider({})
    const params = provider.buildParams({
      model: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.inferenceConfig.maxTokens).toBe(4096)
  })
})

describe('BedrockProvider - content parts edge cases', () => {
  it('maps file/document content part as text placeholder', () => {
    const provider = new BedrockProvider({})
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: 'abc' },
    ]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].text).toContain('application/pdf')
  })

  it('maps user string message to content array with text block', () => {
    const provider = new BedrockProvider({})
    const messages = [{ role: 'user' as const, content: 'hello' }]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content[0].text).toBe('hello')
  })

  it('maps user array content through mapContentParts', () => {
    const provider = new BedrockProvider({})
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'look at this' }] },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content[0].text).toBe('look at this')
  })

  it('maps assistant with array content and toolCalls', () => {
    const provider = new BedrockProvider({})
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'looking' }],
        toolCalls: [{ id: 'call_1', name: 'tool', arguments: '{}' }],
      },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content.some((b: any) => b.text === 'looking')).toBe(true)
    expect(mapped[0].content.some((b: any) => b.toolUse)).toBe(true)
  })
})

describe('BedrockProvider - chat()', () => {
  beforeEach(() => mockClientSend.mockReset())

  it('calls client and returns mapped response with usage', async () => {
    mockClientSend.mockResolvedValue({
      output: {
        message: {
          role: 'assistant',
          content: [{ text: 'Hello from Bedrock' }],
        },
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    const provider = new BedrockProvider({})
    const result = await provider.chat({
      model: 'anthropic.claude-3',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toBe('Hello from Bedrock')
    expect(result.usage?.inputTokens).toBe(10)
    expect(result.usage?.outputTokens).toBe(5)
  })
})

describe('BedrockProvider - stream()', () => {
  beforeEach(() => mockClientSend.mockReset())

  it('yields text deltas and done with usage', async () => {
    mockClientSend.mockResolvedValue({
      stream: (async function* () {
        yield { contentBlockDelta: { delta: { text: 'Hello' } } }
        yield { contentBlockDelta: { delta: { text: ' World' } } }
        yield { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } }
        yield { messageStop: {} }
      })(),
    })
    const provider = new BedrockProvider({})
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1]).toEqual({ type: 'text', delta: ' World' })
    expect(chunks[2].type).toBe('done')
    expect(chunks[2].usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('yields tool call events from stream', async () => {
    mockClientSend.mockResolvedValue({
      stream: (async function* () {
        yield { contentBlockStart: { start: { toolUse: { toolUseId: 'tc_1', name: 'Read' } } } }
        yield { contentBlockDelta: { delta: { toolUse: { input: '{"path":"x"}' } } } }
        yield { messageStop: {} }
      })(),
    })
    const provider = new BedrockProvider({})
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'Read' })
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"x"}' })
  })

  it('emits done even when stream ends without messageStop', async () => {
    mockClientSend.mockResolvedValue({
      stream: (async function* () {
        yield { contentBlockDelta: { delta: { text: 'Hello' } } }
        yield { metadata: { usage: { inputTokens: 5, outputTokens: 3 } } }
      })(),
    })
    const provider = new BedrockProvider({})
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks.at(-1)?.type).toBe('done')
  })

  it('returns early when no stream', async () => {
    mockClientSend.mockResolvedValue({})
    const provider = new BedrockProvider({})
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks).toHaveLength(0)
  })
})
