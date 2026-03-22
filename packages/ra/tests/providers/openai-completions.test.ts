import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockCompletionsCreate = mock()

mock.module('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: mockCompletionsCreate } }
  }
  return { default: MockOpenAI, AzureOpenAI: MockOpenAI }
})

import { OpenAICompletionsProvider as OpenAIProvider } from '@chinmaymk/ra'

describe('OpenAIProvider', () => {
  it('keeps system messages in array', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = provider.mapMessages(messages) as any[]
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
    const mapped = provider.mapTools(tools) as any[]
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].function.name).toBe('test_tool')
  })

  it('maps tool messages with tool_call_id', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'result text', toolCallId: 'call_123' },
    ]
    const mapped = provider.mapMessages(messages) as any[]
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
    const mapped = provider.mapMessages(messages) as any[]
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
    const result = provider.mapResponseToMessage(openaiMsg as any)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.id).toBe('call_1')
    expect(result.toolCalls![0]!.name).toBe('test_tool')
    expect(result.toolCalls![0]!.arguments).toBe('{"x":1}')
  })

  it('maps content parts correctly', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const parts = [
      { type: 'text' as const, text: 'hello' },
      { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc' } },
      { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.png' } },
    ]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0]).toEqual({ type: 'text', text: 'hello' })
    expect(mapped[1].type).toBe('image_url')
    expect(mapped[1].image_url.url).toBe('data:image/png;base64,abc')
    expect(mapped[2].type).toBe('image_url')
    expect(mapped[2].image_url.url).toBe('https://example.com/img.png')
  })
})

describe('thinking / reasoning effort', () => {
  it('adds reasoning effort to buildParams when thinking is set', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'medium',
    })
    expect((params as any).reasoning).toEqual({ effort: 'medium' })
  })

  it('maps low thinking to low effort', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'low',
    })
    expect((params as any).reasoning).toEqual({ effort: 'low' })
  })

  it('maps high thinking to high effort', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'high',
    })
    expect((params as any).reasoning).toEqual({ effort: 'high' })
  })

  it('does not add reasoning when thinking is not set', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'gpt-4o',
      messages: [{ role: 'user' as const, content: 'hi' }],
    })
    expect((params as any).reasoning).toBeUndefined()
  })
})

describe('OpenAIProvider - buildParams branches', () => {
  it('includes tools when provided', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
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
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      providerOptions: { temperature: 0.5 },
    })
    expect(params.temperature).toBe(0.5)
  })
})

describe('OpenAIProvider - toUsage', () => {
  it('maps usage with reasoning tokens', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const usage = provider.toUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 20 },
    })
    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(50)
    expect(usage.thinkingTokens).toBe(20)
  })

  it('maps usage without reasoning tokens', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const usage = provider.toUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
    })
    expect(usage.inputTokens).toBe(100)
    expect(usage.outputTokens).toBe(50)
    expect(usage.thinkingTokens).toBeUndefined()
  })

  it('maps cached prompt tokens to cacheReadTokens', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const usage = provider.toUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 60 },
    })
    expect(usage.cacheReadTokens).toBe(60)
  })

  it('omits cacheReadTokens when not present', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const usage = provider.toUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
    })
    expect(usage.cacheReadTokens).toBeUndefined()
  })
})

describe('OpenAIProvider - content parts edge cases', () => {
  it('maps file content part as text placeholder', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: 'abc' },
    ]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].type).toBe('text')
    expect(mapped[0].text).toContain('application/pdf')
  })

  it('maps system message with array content to joined text', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: [{ type: 'text' as const, text: 'hello ' }, { type: 'text' as const, text: 'world' }] },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content).toBe('hello world')
  })

  it('maps assistant with array content to joined text', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hello' }] },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content).toBe('hello')
  })

  it('maps user message with array content parts', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'look' }, { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.png' } }] },
    ]
    const mapped = provider.mapMessages(messages) as any[]
    expect(mapped[0].content).toHaveLength(2)
  })

  it('maps response with null content', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const msg = { role: 'assistant', content: null, tool_calls: undefined }
    const result = provider.mapResponseToMessage(msg as any)
    expect(result.content).toBe('')
  })
})

describe('OpenAIProvider - chat()', () => {
  beforeEach(() => mockCompletionsCreate.mockReset())

  it('calls client and returns mapped response with usage', async () => {
    mockCompletionsCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello from chat' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const provider = new OpenAIProvider({ apiKey: 'test' })
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
    mockCompletionsCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hi' } }],
    })
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const result = await provider.chat({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.usage).toBeUndefined()
  })
})

describe('OpenAIProvider - stream()', () => {
  beforeEach(() => mockCompletionsCreate.mockReset())

  it('yields text deltas and done with usage', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
    })())
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1].type).toBe('done')
    expect(chunks[1].usage.inputTokens).toBe(10)
  })

  it('yields tool_call_start and tool_call_delta', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc_1', function: { name: 'Read' } }] } }] }
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"x"}' } }] } }] }
      yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
    })())
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'Read' })
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"x"}' })
    expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
  })

  it('skips chunks with no delta', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{}] } // no delta
      yield { choices: [{ delta: { content: 'text' } }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
    })())
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'text' })
  })

  it('captures usage from terminal empty-choices chunk', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
      yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }
    })())
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    const done = chunks.find((c: any) => c.type === 'done')
    expect(done).toBeDefined()
    expect(done.usage).toBeDefined()
    expect(done.usage.inputTokens).toBe(10)
  })

  it('emits done even when stream ends without finish_reason', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] }
    })())
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    const done = chunks.find((c: any) => c.type === 'done')
    expect(done).toBeDefined()
    expect(done.type).toBe('done')
  })
})

describe('OpenAIProvider - extensibility', () => {
  it('allows subclass to override buildParams', () => {
    class TestProvider extends OpenAIProvider {
      override buildParams(request: any) {
        return { ...super.buildParams(request), model: 'overridden' }
      }
    }
    const p = new TestProvider({ apiKey: 'test' })
    const params = p.buildParams({
      model: 'original',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.model).toBe('overridden')
  })
})
