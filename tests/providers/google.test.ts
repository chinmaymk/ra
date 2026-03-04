import { describe, it, expect } from 'bun:test'
import { GoogleProvider } from '../../src/providers/google'
import { extractSystemMessages } from '../../src/providers/utils'

describe('GoogleProvider', () => {
  it('has correct name', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    expect(provider.name).toBe('google')
  })

  it('extracts system messages from message array', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { system, filtered } = extractSystemMessages(messages)
    expect(system).toBe('You are helpful')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.role).toBe('user')
  })

  it('extracts multiple system messages joined with newline', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'First instruction' },
      { role: 'system' as const, content: 'Second instruction' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { system, filtered } = extractSystemMessages(messages)
    expect(system).toBe('First instruction\nSecond instruction')
    expect(filtered).toHaveLength(1)
  })

  it('returns undefined system when no system messages', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'user' as const, content: 'hello' },
    ]
    const { system, filtered } = extractSystemMessages(messages)
    expect(system).toBeUndefined()
    expect(filtered).toHaveLength(1)
  })

  it('maps user messages to Gemini format with user role', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].parts[0].text).toBe('hello')
  })

  it('maps assistant messages to Gemini format with model role', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'assistant' as const, content: 'I can help' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('model')
    expect(mapped[0].parts[0].text).toBe('I can help')
  })

  it('maps image content parts to inlineData format', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Look at this' },
          { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc123' } },
        ],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].parts[0].text).toBe('Look at this')
    expect(mapped[0].parts[1].inlineData).toBeDefined()
    expect(mapped[0].parts[1].inlineData.mimeType).toBe('image/png')
    expect(mapped[0].parts[1].inlineData.data).toBe('abc123')
  })

  it('maps tools to Gemini functionDeclarations format', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = (provider as any).mapTools(tools)
    expect(mapped).toHaveLength(1)
    expect(mapped[0].functionDeclarations).toHaveLength(1)
    expect(mapped[0].functionDeclarations[0].name).toBe('test_tool')
    expect(mapped[0].functionDeclarations[0].description).toBe('A test tool')
    expect(mapped[0].functionDeclarations[0].parameters).toEqual({ type: 'object', properties: { x: { type: 'number' } } })
  })

  it('maps assistant messages with toolCalls to functionCall parts', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('model')
    const fcPart = mapped[0].parts.find((p: any) => p.functionCall)
    expect(fcPart).toBeDefined()
    expect(fcPart.functionCall.name).toBe('test_tool')
    expect(fcPart.functionCall.args).toEqual({ x: 1 })
  })

  it('maps tool result messages to functionResponse parts', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'result text', toolCallId: 'call_123' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('user')
    const frPart = mapped[0].parts.find((p: any) => p.functionResponse)
    expect(frPart).toBeDefined()
    expect(frPart.functionResponse.name).toBe('call_123')
    expect(frPart.functionResponse.response.content).toBe('result text')
  })

  it('maps Gemini response back to IMessage', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const geminiResponse = {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: 'Hello there' }],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }
    const result = (provider as any).mapResponseToMessage(geminiResponse)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello there')
    expect(result.toolCalls).toBeUndefined()
  })

  it('maps Gemini response with functionCall to toolCalls', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const geminiResponse = {
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { functionCall: { name: 'test_tool', args: { x: 1 } } },
          ],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }
    const result = (provider as any).mapResponseToMessage(geminiResponse)
    expect(result.role).toBe('assistant')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('test_tool')
    expect(result.toolCalls[0].arguments).toBe('{"x":1}')
  })
})
