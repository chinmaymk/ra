import { describe, it, expect, mock, beforeEach } from 'bun:test'

const mockResponsesCreate = mock()

mock.module('openai', () => {
  class MockOpenAI {
    responses = { create: mockResponsesCreate }
  }
  return { default: MockOpenAI, AzureOpenAI: MockOpenAI }
})

import { OpenAIResponsesProvider } from '@chinmaymk/ra'

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
    expect(mapped[1]).toEqual({ type: 'input_image', image_url: 'data:image/png;base64,abc', detail: 'auto' })
    expect(mapped[2]).toEqual({ type: 'input_image', image_url: 'https://example.com/img.png', detail: 'auto' })
  })

  it('maps file content part as input_file with base64 data URI', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: 'abc' },
    ]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].type).toBe('input_file')
    expect(mapped[0].file_data).toBe('data:application/pdf;base64,abc')
  })

  it('maps file content part with Buffer data to base64', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'image/png', data: Buffer.from('hello') },
    ]
    const mapped = provider.mapContentParts(parts) as any[]
    expect(mapped[0].type).toBe('input_file')
    expect(mapped[0].file_data).toBe(`data:image/png;base64,${Buffer.from('hello').toString('base64')}`)
  })
})

describe('OpenAIResponsesProvider - multimodal message mapping', () => {
  it('maps user message with image content parts through mapMessages', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [{
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'What is in this image?' },
        { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/cat.png' } },
      ],
    }]
    const { input } = provider.mapMessages(messages)
    const userMsg = input[0] as any
    expect(userMsg.type).toBe('message')
    expect(userMsg.role).toBe('user')
    expect(userMsg.content).toHaveLength(2)
    expect(userMsg.content[0]).toEqual({ type: 'input_text', text: 'What is in this image?' })
    expect(userMsg.content[1]).toEqual({ type: 'input_image', image_url: 'https://example.com/cat.png', detail: 'auto' })
  })

  it('maps user message with file content part through mapMessages', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [{
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'Summarize this PDF' },
        { type: 'file' as const, mimeType: 'application/pdf', data: 'pdfdata' },
      ],
    }]
    const { input } = provider.mapMessages(messages)
    const userMsg = input[0] as any
    expect(userMsg.content).toHaveLength(2)
    expect(userMsg.content[1].type).toBe('input_file')
    expect(userMsg.content[1].file_data).toBe('data:application/pdf;base64,pdfdata')
  })

  it('maps system message with array content to joined instructions', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: [{ type: 'text' as const, text: 'hello ' }, { type: 'text' as const, text: 'world' }] },
      { role: 'user' as const, content: 'hi' },
    ]
    const { instructions } = provider.mapMessages(messages)
    expect(instructions).toBe('hello world')
  })

  it('maps assistant message with only toolCalls and no text', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [{
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'call_1', name: 'Read', arguments: '{"path":"x"}' }],
    }]
    const { input } = provider.mapMessages(messages)
    // No assistant message item (empty text), only a function_call
    expect(input).toHaveLength(1)
    expect((input[0] as any).type).toBe('function_call')
    expect((input[0] as any).call_id).toBe('call_1')
  })

  it('returns undefined instructions when no system messages', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [{ role: 'user' as const, content: 'hi' }]
    const { instructions, input } = provider.mapMessages(messages)
    expect(instructions).toBeUndefined()
    expect(input).toHaveLength(1)
  })

  it('handles full conversation round-trip', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'Read file x' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_1', name: 'Read', arguments: '{"path":"x"}' }] },
      { role: 'tool' as const, content: 'file contents here', toolCallId: 'call_1' },
      { role: 'assistant' as const, content: 'The file contains...' },
      { role: 'user' as const, content: 'thanks' },
    ]
    const { instructions, input } = provider.mapMessages(messages)
    expect(instructions).toBe('You are helpful')
    expect(input).toHaveLength(5)
    expect((input[0] as any).type).toBe('message')     // user: Read file x
    expect((input[1] as any).type).toBe('function_call') // assistant tool call
    expect((input[2] as any).type).toBe('function_call_output') // tool result
    expect((input[3] as any).type).toBe('message')      // assistant: The file contains...
    expect((input[4] as any).type).toBe('message')       // user: thanks
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

  it('maps low thinking to low effort', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'low',
    })
    expect((params as any).reasoning).toEqual({ effort: 'low' })
  })

  it('maps high thinking to high effort', () => {
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const params = provider.buildParams({
      model: 'o3',
      messages: [{ role: 'user' as const, content: 'hi' }],
      thinking: 'high',
    })
    expect((params as any).reasoning).toEqual({ effort: 'high' })
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
      yield { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'item_0', call_id: 'tc_1', name: 'Read' } }
      yield { type: 'response.function_call_arguments.delta', item_id: 'item_0', output_index: 0, delta: '{"path":"x"}' }
      yield { type: 'response.function_call_arguments.done', item_id: 'item_0', output_index: 0, name: 'Read', arguments: '{"path":"x"}' }
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

  it('handles multiple parallel tool calls', async () => {
    mockResponsesCreate.mockResolvedValue((async function* () {
      yield { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'item_0', call_id: 'tc_1', name: 'Read' } }
      yield { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'item_1', call_id: 'tc_2', name: 'Write' } }
      yield { type: 'response.function_call_arguments.delta', item_id: 'item_0', output_index: 0, delta: '{"path":"a"}' }
      yield { type: 'response.function_call_arguments.delta', item_id: 'item_1', output_index: 1, delta: '{"path":"b"}' }
      yield { type: 'response.function_call_arguments.done', item_id: 'item_0', output_index: 0, name: 'Read', arguments: '{"path":"a"}' }
      yield { type: 'response.function_call_arguments.done', item_id: 'item_1', output_index: 1, name: 'Write', arguments: '{"path":"b"}' }
      yield { type: 'response.completed', response: {} }
    })())
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'Read' })
    expect(chunks[1]).toEqual({ type: 'tool_call_start', id: 'tc_2', name: 'Write' })
    expect(chunks[2]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"a"}' })
    expect(chunks[3]).toEqual({ type: 'tool_call_delta', id: 'tc_2', argsDelta: '{"path":"b"}' })
    expect(chunks[4]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
    expect(chunks[5]).toEqual({ type: 'tool_call_end', id: 'tc_2' })
  })

  it('handles text followed by tool calls', async () => {
    mockResponsesCreate.mockResolvedValue((async function* () {
      yield { type: 'response.output_text.delta', delta: 'Let me help. ' }
      yield { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'item_1', call_id: 'tc_1', name: 'Read' } }
      yield { type: 'response.function_call_arguments.delta', item_id: 'item_1', output_index: 1, delta: '{}' }
      yield { type: 'response.function_call_arguments.done', item_id: 'item_1', output_index: 1, name: 'Read', arguments: '{}' }
      yield { type: 'response.completed', response: { usage: { input_tokens: 10, output_tokens: 15 } } }
    })())
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Let me help. ' })
    expect(chunks[1]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'Read' })
    expect(chunks[2]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{}' })
    expect(chunks[3]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
    expect(chunks[4].type).toBe('done')
    expect(chunks[4].usage.inputTokens).toBe(10)
  })

  it('ignores unhandled event types gracefully', async () => {
    mockResponsesCreate.mockResolvedValue((async function* () {
      yield { type: 'response.created', response: { id: 'resp_1' } }
      yield { type: 'response.output_text.delta', delta: 'Hello' }
      yield { type: 'response.content_part.added', part: {} }
      yield { type: 'response.completed', response: {} }
    })())
    const provider = new OpenAIResponsesProvider({ apiKey: 'test' })
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1].type).toBe('done')
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
