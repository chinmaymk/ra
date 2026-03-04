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
