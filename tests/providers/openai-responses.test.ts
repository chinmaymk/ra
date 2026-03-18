import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockResponsesCreate = mock()

mock.module('openai', () => {
  class MockOpenAI {
    responses = { create: mockResponsesCreate }
  }
  return { default: MockOpenAI, AzureOpenAI: MockOpenAI }
})

import { OpenAIResponsesProvider } from '../../src/providers/openai-responses'

describe('OpenAIResponsesProvider', () => {
  it('extracts system messages into instructions', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { instructions, input } = provider.mapMessages(messages)
    expect(instructions).toBe('You are helpful')
    expect(input).toHaveLength(1)
    expect((input[0] as any).role).toBe('user')
  })

  it('concatenates multiple system messages', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'First instruction' },
      { role: 'system' as const, content: 'Second instruction' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { instructions } = provider.mapMessages(messages)
    expect(instructions).toBe('First instruction\n\nSecond instruction')
  })

  it('maps tools to Responses API format', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = provider.mapTools(tools) as any[]
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].name).toBe('test_tool')
    expect(mapped[0].description).toBe('A test tool')
    expect(mapped[0].parameters).toEqual({ type: 'object', properties: { x: { type: 'number' } } })
  })

  it('maps tool result messages to function_call_output', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'result text', toolCallId: 'call_123' },
    ]
    const { input } = provider.mapMessages(messages)
    expect((input[0] as any).type).toBe('function_call_output')
    expect((input[0] as any).call_id).toBe('call_123')
    expect((input[0] as any).output).toBe('result text')
  })

  it('maps assistant messages with toolCalls to function_call items', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Let me call a tool',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }],
      },
    ]
    const { input } = provider.mapMessages(messages)
    // Should have both an assistant message and a function_call
    expect(input).toHaveLength(2)
    expect((input[0] as any).type).toBe('message')
    expect((input[0] as any).role).toBe('assistant')
    expect((input[1] as any).type).toBe('function_call')
    expect((input[1] as any).call_id).toBe('call_1')
    expect((input[1] as any).name).toBe('test_tool')
    expect((input[1] as any).arguments).toBe('{"x":1}')
  })

  it('maps response back to IMessage', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const response = {
      output_text: 'Hello',
      output: [
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'test_tool',
          arguments: '{"x":1}',
        },
      ],
    }
    const result = provider.mapResponseToMessage(response as any)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.id).toBe('call_1')
    expect(result.toolCalls![0]!.name).toBe('test_tool')
    expect(result.toolCalls![0]!.arguments).toBe('{"x":1}')
  })

  it('maps content parts correctly', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const parts = [
      { type: 'text' as const, text: 'hello' },
      { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc' } },
      { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.png' } },
    ]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0]).toEqual({ type: 'input_text', text: 'hello' })
    expect(mapped[1].type).toBe('input_image')
    expect(mapped[1].image_url).toBe('data:image/png;base64,abc')
    expect(mapped[2].type).toBe('input_image')
    expect(mapped[2].image_url).toBe('https://example.com/img.png')
  })

  it('maps file content part as text placeholder', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: 'abc' },
    ]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].type).toBe('input_text')
    expect(mapped[0].text).toContain('application/pdf')
  })
})

describe('OpenAIResponsesProvider - buildParams', () => {
  it('adds reasoning effort when thinking is set', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'medium',
    })
    expect((params as any).reasoning).toEqual({ effort: 'medium' })
  })

  it('does not add reasoning when thinking is not set', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'gpt-4o',
      messages: [{ role: 'user' as const, content: 'hi' }],
    })
    expect((params as any).reasoning).toBeUndefined()
  })

  it('includes tools when provided', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const tools = [{ name: 'tool', description: 'desc', inputSchema: {}, execute: async () => ({}) }]
    const params = provider.buildParams({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
    })
    expect(params.tools).toBeDefined()
    expect(params.tools).toHaveLength(1)
  })

  it('merges providerOptions into params', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      providerOptions: { temperature: 0.5 },
    })
    expect((params as any).temperature).toBe(0.5)
  })

  it('sets instructions from system messages', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(params.instructions).toBe('Be concise')
  })
})

describe('OpenAIResponsesProvider - toUsage', () => {
  it('maps usage with reasoning tokens', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const usage = provider.toUsage({
      input_tokens: 100,
      output_tokens: 50,
      output_tokens_details: { reasoning_tokens: 20 },
    })
    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(50)
    expect(usage.thinkingTokens).toBe(20)
  })

  it('maps usage without reasoning tokens', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const usage = provider.toUsage({
      input_tokens: 100,
      output_tokens: 50,
    })
    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(50)
    expect(usage.thinkingTokens).toBeUndefined()
  })
})

describe('OpenAIResponsesProvider - chat()', () => {
  beforeEach(() => mockResponsesCreate.mockReset())

  it('calls client and returns mapped response with usage', async () => {
    mockResponsesCreate.mockResolvedValue({
      output_text: 'Hello from chat',
      output: [],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const result = await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toBe('Hello from chat')
    expect(result.usage?.inputTokens).toBe(10)
    expect(result.usage?.outputTokens).toBe(5)
  })

  it('returns undefined usage when not present in response', async () => {
    mockResponsesCreate.mockResolvedValue({
      output_text: 'Hi',
      output: [],
    })
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const result = await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.usage).toBeUndefined()
  })

  it('maps function calls from response output', async () => {
    mockResponsesCreate.mockResolvedValue({
      output_text: '',
      output: [
        { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"path":"x"}' },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const result = await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'read file x' }],
    })
    expect(result.message.toolCalls).toHaveLength(1)
    expect(result.message.toolCalls![0]!.id).toBe('call_1')
    expect(result.message.toolCalls![0]!.name).toBe('Read')
  })
})

describe('OpenAIResponsesProvider - stream()', () => {
  beforeEach(() => mockResponsesCreate.mockReset())

  it('yields text deltas and done with usage', async () => {
    mockResponsesCreate.mockResolvedValue((async function* () {
      yield { type: 'response.output_text.delta', delta: 'Hello' }
      yield { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5 } } }
    })())
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1].type).toBe('done')
    expect(chunks[1].usage.inputTokens).toBe(10)
  })

  it('yields thinking deltas', async () => {
    mockResponsesCreate.mockResolvedValue((async function* () {
      yield { type: 'response.reasoning_text.delta', delta: 'thinking...' }
      yield { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 5 } } }
    })())
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'o3', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'thinking...' })
  })

  it('yields tool_call_start, tool_call_delta, and tool_call_end', async () => {
    mockResponsesCreate.mockResolvedValue((async function* () {
      yield { type: 'response.output_item.added', item_id: 'item_0', item: { type: 'function_call', id: 'item_0', call_id: 'tc_1', name: 'Read' } }
      yield { type: 'response.function_call_arguments.delta', item_id: 'item_0', delta: '{"path":"x"}' }
      yield { type: 'response.function_call_arguments.done', item_id: 'item_0', name: 'Read', arguments: '{"path":"x"}' }
      yield { type: 'response.completed', response: {} }
    })())
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'Read' })
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"x"}' })
    expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
  })

  it('emits done even when stream ends without completed event', async () => {
    mockResponsesCreate.mockResolvedValue((async function* () {
      yield { type: 'response.output_text.delta', delta: 'Hello' }
    })())
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    const done = chunks.find((c: any) => c.type === 'done')
    expect(done).toBeDefined()
    expect(done.type).toBe('done')
  })
})

describe('OpenAIResponsesProvider - response with no text', () => {
  it('maps response with no output_text', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const response = { output_text: null, output: [] }
    const result = provider.mapResponseToMessage(response as any)
    expect(result.content).toBe('')
    expect(result.toolCalls).toBeUndefined()
  })
})
