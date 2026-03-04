import { describe, it, expect } from 'bun:test'
import { OllamaProvider } from '../../src/providers/ollama'

describe('OllamaProvider', () => {
  it('has correct name', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    expect(provider.name).toBe('ollama')
  })

  it('keeps system messages as role:system', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('system')
    expect(mapped[0].content).toBe('You are helpful')
    expect(mapped).toHaveLength(2)
  })

  it('maps tools to function format', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = (provider as any).mapTools(tools)
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].function.name).toBe('test_tool')
    expect(mapped[0].function.description).toBe('A test tool')
    expect(mapped[0].function.parameters).toEqual({ type: 'object', properties: { x: { type: 'number' } } })
  })

  it('maps tool messages with toolCallId', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      { role: 'tool' as const, content: 'result text', toolCallId: 'call_123' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('tool')
    expect(mapped[0].content).toBe('result text')
  })

  it('maps assistant messages with toolCalls', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('assistant')
    expect(mapped[0].tool_calls).toHaveLength(1)
    expect(mapped[0].tool_calls[0].function.name).toBe('test_tool')
    expect(mapped[0].tool_calls[0].function.arguments).toEqual({ x: 1 })
  })

  it('maps Ollama response back to IMessage', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const ollamaMsg = {
      role: 'assistant',
      content: 'Hello',
      tool_calls: [
        {
          function: { name: 'test_tool', arguments: { x: 1 } },
        },
      ],
    }
    const result = (provider as any).mapResponseToMessage(ollamaMsg, 0)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('test_tool')
    expect(result.toolCalls[0].arguments).toBe('{"x":1}')
  })

  it('maps response without tool_calls', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const ollamaMsg = {
      role: 'assistant',
      content: 'Just text',
    }
    const result = (provider as any).mapResponseToMessage(ollamaMsg, 0)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Just text')
    expect(result.toolCalls).toBeUndefined()
  })
})
