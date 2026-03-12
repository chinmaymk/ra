import { describe, it, expect, mock, beforeEach } from 'bun:test'
import {
  testTool, textPart, base64ImagePart, urlImagePart, filePart, fileBufferPart,
  toolMessage, assistantWithToolCalls, assistantArrayContent, userArrayContent,
  collectChunks, streamReq, testBuildParamsWithTools, testMalformedJsonArgs,
  testMapResponseTextOnly,
} from './shared-provider-tests'

const mockMessagesCreate = mock()
mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic { messages = { create: mockMessagesCreate } },
}))

import { AnthropicProvider } from '../../src/providers/anthropic'

const p = () => new AnthropicProvider({ apiKey: 'test' })

describe('AnthropicProvider', () => {
  it('maps tools to Anthropic format', () => {
    const mapped = p().mapTools([testTool]) as any[]
    expect(mapped[0].name).toBe('test_tool')
    expect(mapped[0].input_schema).toBeDefined()
  })

  it('maps tool messages to user messages with tool_result content', () => {
    const mapped = p().mapMessages([toolMessage]) as any[]
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].content[0].type).toBe('tool_result')
    expect(mapped[0].content[0].tool_use_id).toBe('call_123')
    expect(mapped[0].content[0].content).toBe('result text')
  })

  testMalformedJsonArgs(p(), (mapped) => {
    const toolUse = mapped[0].content.find((b: any) => b.type === 'tool_use')
    return toolUse.input
  })

  it('maps assistant messages with toolCalls to tool_use blocks', () => {
    const mapped = p().mapMessages([assistantWithToolCalls]) as any[]
    expect(mapped[0].role).toBe('assistant')
    const content = mapped[0].content as any[]
    expect(content.some((b: any) => b.type === 'text')).toBe(true)
    const toolUse = content.find((b: any) => b.type === 'tool_use')
    expect(toolUse.id).toBe('call_1')
    expect(toolUse.input).toEqual({ x: 1 })
  })

  it('maps Anthropic response back to IMessage', () => {
    const result = p().mapResponseToMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }, { type: 'tool_use', id: 'call_1', name: 'test_tool', input: { x: 1 } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    } as any)
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.arguments).toBe('{"x":1}')
  })

  it('maps content parts correctly', () => {
    const mapped = p().mapContentParts([textPart, base64ImagePart]) as any[]
    expect(mapped[0]).toEqual({ type: 'text', text: 'hello' })
    expect(mapped[1].type).toBe('image')
    expect(mapped[1].source.type).toBe('base64')
  })

  it('maps URL image content parts', () => {
    const mapped = p().mapContentParts([urlImagePart]) as any[]
    expect(mapped[0].source.type).toBe('url')
    expect(mapped[0].source.url).toBe('https://example.com/img.png')
  })

  it('maps file/document content parts to base64 document', () => {
    const mapped = p().mapContentParts([filePart]) as any[]
    expect(mapped[0].type).toBe('document')
    expect(mapped[0].source.media_type).toBe('application/pdf')
  })

  it('maps file content parts with Buffer data', () => {
    const mapped = p().mapContentParts([fileBufferPart]) as any[]
    expect(mapped[0].source.data).toBe(Buffer.from('pdfdata').toString('base64'))
  })

  testBuildParamsWithTools(p(), 'claude-3')

  it('adds cache_control to system prompt in buildParams', () => {
    const params = p().buildParams({ model: 'claude-sonnet-4-6', messages: [{ role: 'system', content: 'You are helpful.' }, { role: 'user', content: 'hi' }] }) as any
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('adds cache_control to last tool definition', () => {
    const tools = [
      { name: 'tool_a', description: 'desc a', inputSchema: { type: 'object' }, execute: async () => '' },
      { name: 'tool_b', description: 'desc b', inputSchema: { type: 'object' }, execute: async () => '' },
    ]
    const mapped = p().mapTools(tools) as any[]
    expect(mapped[0].cache_control).toBeUndefined()
    expect(mapped[1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('adds cache_control to single tool', () => {
    const mapped = p().mapTools([{ name: 'only_tool', description: 'desc', inputSchema: { type: 'object' }, execute: async () => '' }]) as any[]
    expect(mapped[0].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('buildParams uses providerOptions maxTokens', () => {
    expect(p().buildParams({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }], providerOptions: { maxTokens: 8192 } }).max_tokens).toBe(8192)
  })

  it('buildParams defaults maxTokens to 4096', () => {
    expect(p().buildParams({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] }).max_tokens).toBe(4096)
  })

  it('maps assistant message with array content and toolCalls', () => {
    const mapped = p().mapMessages([assistantArrayContent]) as any[]
    expect(mapped[0].content.some((b: any) => b.type === 'text')).toBe(true)
    expect(mapped[0].content.some((b: any) => b.type === 'tool_use')).toBe(true)
  })

  it('maps user message with array content', () => {
    const mapped = p().mapMessages([userArrayContent]) as any[]
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].content[0].type).toBe('text')
  })

  testMapResponseTextOnly(p(), {
    role: 'assistant', content: [{ type: 'text', text: 'Just text' }],
    usage: { input_tokens: 5, output_tokens: 3 },
  } as any, 'Just text')
})

describe('AnthropicProvider - chat()', () => {
  beforeEach(() => mockMessagesCreate.mockReset())

  it('calls client and returns mapped response with usage', async () => {
    mockMessagesCreate.mockResolvedValue({
      role: 'assistant', content: [{ type: 'text', text: 'Hello from chat' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    })
    const result = await p().chat({ model: 'claude-3', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.message.content).toBe('Hello from chat')
    expect(result.usage?.inputTokens).toBe(10)
  })
})

describe('AnthropicProvider - stream()', () => {
  beforeEach(() => mockMessagesCreate.mockReset())
  const req = streamReq('claude-3')

  it('yields text deltas from content_block_delta events', async () => {
    mockMessagesCreate.mockResolvedValue((async function* () {
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
      yield { type: 'message_delta', usage: { input_tokens: 10, output_tokens: 5 } }
      yield { type: 'message_stop' }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1].type).toBe('done')
  })

  it('yields tool_call_start from content_block_start with tool_use', async () => {
    mockMessagesCreate.mockResolvedValue((async function* () {
      yield { type: 'content_block_start', content_block: { type: 'tool_use', id: 'tc_1', name: 'read_file' } }
      yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"path":' } }
      yield { type: 'message_delta', usage: { input_tokens: 10, output_tokens: 5 } }
      yield { type: 'message_stop' }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'read_file' })
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":' })
  })

  it('yields thinking deltas from thinking_delta events', async () => {
    mockMessagesCreate.mockResolvedValue((async function* () {
      yield { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'Let me think...' } }
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Answer' } }
      yield { type: 'message_delta', usage: { input_tokens: 0, output_tokens: 10 } }
      yield { type: 'message_stop' }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Let me think...' })
    expect(chunks[1]).toEqual({ type: 'text', delta: 'Answer' })
  })

  it('emits done even when stream ends without message_stop', async () => {
    mockMessagesCreate.mockResolvedValue((async function* () {
      yield { type: 'message_start', message: { usage: { input_tokens: 10 } } }
      yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks.at(-1)?.type).toBe('done')
  })

  it('captures inputTokens from message_start, not message_delta', async () => {
    mockMessagesCreate.mockResolvedValue((async function* () {
      yield { type: 'message_start', message: { usage: { input_tokens: 42 } } }
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }
      yield { type: 'message_delta', usage: { output_tokens: 7 } }
      yield { type: 'message_stop' }
    })())
    const chunks = await collectChunks(p().stream(req))
    const done = chunks.find(c => c.type === 'done')
    expect(done.usage.inputTokens).toBe(42)
    expect(done.usage.outputTokens).toBe(7)
  })

  it('tracks tool call IDs correctly for parallel tool calls', async () => {
    mockMessagesCreate.mockResolvedValue((async function* () {
      yield { type: 'message_start', message: { usage: { input_tokens: 10 } } }
      yield { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'read' } }
      yield { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool_2', name: 'write' } }
      yield { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":1}' } }
      yield { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"b":2}' } }
      yield { type: 'message_delta', usage: { output_tokens: 5 } }
      yield { type: 'message_stop' }
    })())
    const chunks = await collectChunks(p().stream(req))
    const deltas = chunks.filter((c: any) => c.type === 'tool_call_delta')
    expect(deltas).toHaveLength(2)
    expect(deltas[0].id).toBe('tool_1')
    expect(deltas[1].id).toBe('tool_2')
  })

  it('defaults inputTokens to 0 when message_start has no usage', async () => {
    mockMessagesCreate.mockResolvedValue((async function* () {
      yield { type: 'message_start', message: {} }
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } }
      yield { type: 'message_delta', usage: { output_tokens: 3 } }
      yield { type: 'message_stop' }
    })())
    const chunks = await collectChunks(p().stream(req))
    const done = chunks.find(c => c.type === 'done')
    expect(done.usage.inputTokens).toBe(0)
  })
})

describe('thinking', () => {
  it('includes thinking param in buildParams when thinking is set', () => {
    expect((p().buildParams({ model: 'claude-3-7-sonnet-20250219', messages: [{ role: 'user', content: 'hi' }], thinking: 'medium' as const }) as any).thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })
  })
  it('maps low to 1000 tokens', () => {
    expect((p().buildParams({ model: 'x', messages: [], thinking: 'low' }) as any).thinking.budget_tokens).toBe(1000)
  })
  it('maps high to 32000 tokens', () => {
    expect((p().buildParams({ model: 'x', messages: [], thinking: 'high' }) as any).thinking.budget_tokens).toBe(32000)
  })
})
