import { describe, it, expect } from 'bun:test'
import { BedrockProvider } from '../../src/providers/bedrock'

describe('BedrockProvider', () => {
  const provider = new BedrockProvider({})

  it('maps tool result message to user role with toolResult block', () => {
    const messages = [{ role: 'tool' as const, content: 'tool output', toolCallId: 'call_abc' }]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].content[0].toolResult.toolUseId).toBe('call_abc')
    expect(mapped[0].content[0].toolResult.content[0].text).toBe('tool output')
  })

  it('maps assistant with toolCalls to toolUse blocks alongside text', () => {
    const messages = [{
      role: 'assistant' as const,
      content: 'calling tool',
      toolCalls: [{ id: 'call_1', name: 'my_tool', arguments: '{"x":42}' }],
    }]
    const mapped = (provider as any).mapMessages(messages)
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
    const mapped = (provider as any).mapMessages(messages)
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
    const mapped = (provider as any).mapTools(tools)
    expect(mapped[0].toolSpec.name).toBe('search')
    expect(mapped[0].toolSpec.description).toBe('Search the web')
    expect(mapped[0].toolSpec.inputSchema.json).toEqual(tools[0]!.inputSchema)
  })

  it('maps base64 image, extracting format from mediaType', () => {
    const parts = [{
      type: 'image' as const,
      source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc123' },
    }]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].image.format).toBe('png')
  })

  it('falls back to text for URL images (not natively supported)', () => {
    const parts = [{
      type: 'image' as const,
      source: { type: 'url' as const, url: 'https://example.com/img.jpg' },
    }]
    const mapped = (provider as any).mapContentParts(parts)
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
    const result = (provider as any).mapResponseToMessage(bedrockMsg)
    expect(result.content).toBe('Using tool')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].id).toBe('call_1')
    expect(result.toolCalls[0].arguments).toBe('{"q":"test"}')
  })

  it('handles undefined response message gracefully', () => {
    const result = (provider as any).mapResponseToMessage(undefined)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('')
  })
})

describe('thinking', () => {
  it('includes additionalModelRequestFields when thinking is set', () => {
    const provider = new BedrockProvider({})
    const params = (provider as any).buildParams({
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
    const params = (provider as any).buildParams({ model: 'x', messages: [] })
    expect(params.additionalModelRequestFields).toBeUndefined()
  })
})
