import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockOllamaChat = mock()

mock.module('ollama', () => ({
  Ollama: class MockOllama {
    chat = mockOllamaChat
  },
}))

import { OllamaProvider } from '@chinmaymk/ra'

describe('OllamaProvider', () => {
  it('keeps system messages as role:system', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = provider.mapMessages(messages) as any[]
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
    const mapped = provider.mapTools(tools) as any[]
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
    const mapped = provider.mapMessages(messages) as any[]
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
    const mapped = provider.mapMessages(messages) as any[]
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
    const result = provider.mapResponseToMessage(ollamaMsg as any)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.name).toBe('test_tool')
    expect(result.toolCalls![0]!.arguments).toBe('{"x":1}')
  })

  it('maps response without tool_calls', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const ollamaMsg = {
      role: 'assistant',
      content: 'Just text',
    }
    const result = provider.mapResponseToMessage(ollamaMsg as any)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Just text')
    expect(result.toolCalls).toBeUndefined()
  })

  it('buildParams includes tools when provided', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const tools = [{ name: 'tool', description: 'desc', inputSchema: {}, execute: async () => ({}) }]
    const params = provider.buildParams({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
    })
    expect(params.tools).toBeDefined()
    expect(params.tools).toHaveLength(1)
  })

  it('buildParams merges providerOptions', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const params = provider.buildParams({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
      providerOptions: { temperature: 0.7 },
    })
    expect((params as any).temperature).toBe(0.7)
  })

  it('maps user message with array content to joined text', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'hello ' }, { type: 'text' as const, text: 'world' }] },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content).toBe('hello world')
  })

  it('maps system message with array content to joined text', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      { role: 'system' as const, content: [{ type: 'text' as const, text: 'sys' }] },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content).toBe('sys')
  })

  it('maps tool message with non-string content to JSON', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      { role: 'tool' as const, content: [{ type: 'text' as const, text: 'result' }], toolCallId: 'tc1' },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content).toBe(JSON.stringify([{ type: 'text', text: 'result' }]))
  })

  it('maps assistant with string content to empty when array', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hi' }] },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    // Array content on assistant results in empty string
    expect(mapped[0].content).toBe('')
  })

  it('handles invalid JSON arguments in toolCalls gracefully', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'call_1', name: 'tool', arguments: 'invalid json' }],
      },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].tool_calls[0].function.arguments).toEqual({})
  })

  it('maps response with null content', () => {
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const msg = { role: 'assistant', content: undefined }
    const result = provider.mapResponseToMessage(msg as any)
    expect(result.content).toBe('')
  })
})

describe('OllamaProvider - chat()', () => {
  beforeEach(() => mockOllamaChat.mockReset())

  it('calls client and returns mapped response', async () => {
    mockOllamaChat.mockResolvedValue({
      message: { role: 'assistant', content: 'Hello from Ollama' },
    })
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const result = await provider.chat({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toBe('Hello from Ollama')
  })

  it('returns response with tool calls', async () => {
    mockOllamaChat.mockResolvedValue({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'tool', arguments: { x: 1 } } }],
      },
    })
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const result = await provider.chat({
      model: 'llama3',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const toolCalls = result.message.toolCalls
    if (!toolCalls) throw new Error('Expected toolCalls to be defined')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.name).toBe('tool')
  })
})

describe('OllamaProvider - stream()', () => {
  beforeEach(() => mockOllamaChat.mockReset())

  it('yields text deltas and done with usage', async () => {
    mockOllamaChat.mockResolvedValue((async function* () {
      yield { message: { content: 'Hello' }, done: false }
      yield { message: { content: ' World' }, done: false }
      yield { message: {}, done: true, prompt_eval_count: 10, eval_count: 5 }
    })())
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1]).toEqual({ type: 'text', delta: ' World' })
    expect(chunks[2].type).toBe('done')
    expect(chunks[2].usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('yields tool call events from stream', async () => {
    mockOllamaChat.mockResolvedValue((async function* () {
      yield { message: { tool_calls: [{ function: { name: 'tool', arguments: { x: 1 } } }] }, done: false }
      yield { message: {}, done: true }
    })())
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'call_0', name: 'tool' })
    expect(chunks[1].type).toBe('tool_call_delta')
    expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'call_0' })
  })

  it('skips messages with no content or tool_calls', async () => {
    mockOllamaChat.mockResolvedValue((async function* () {
      yield { message: undefined, done: false }  // no msg
      yield { message: { content: 'text' }, done: false }
      yield { message: {}, done: true }
    })())
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'text' })
    expect(chunks[1].type).toBe('done')
  })

  it('done without eval counts yields undefined usage', async () => {
    mockOllamaChat.mockResolvedValue((async function* () {
      yield { message: {}, done: true }
    })())
    const provider = new OllamaProvider({ host: 'http://localhost:11434' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'done', usage: undefined })
  })
})
