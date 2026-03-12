import { describe, it, expect, mock, beforeEach } from 'bun:test'
import {
  testTool, base64ImagePart, urlImagePart, filePart,
  toolMessage, assistantWithToolCalls, assistantArrayContent, userArrayContent,
  collectChunks, streamReq, testMalformedJsonArgs,
} from './shared-provider-tests'

const mockClientSend = mock()
mock.module('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: class MockBedrockRuntimeClient { send = mockClientSend },
  ConverseCommand: class ConverseCommand { constructor(public input: any) {} },
  ConverseStreamCommand: class ConverseStreamCommand { constructor(public input: any) {} },
}))

import { BedrockProvider } from '../../src/providers/bedrock'

const p = () => new BedrockProvider({})

describe('BedrockProvider', () => {
  it('maps tool result message to user role with toolResult block', () => {
    const mapped = p().mapMessages([toolMessage]) as any[]
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].content[0].toolResult.toolUseId).toBe('call_123')
    expect(mapped[0].content[0].toolResult.content[0].text).toBe('result text')
  })

  testMalformedJsonArgs(p(), (mapped) => {
    const toolBlock = mapped[0].content.find((b: any) => b.toolUse)
    return toolBlock!.toolUse.input
  })

  it('maps assistant with toolCalls to toolUse blocks alongside text', () => {
    const mapped = p().mapMessages([assistantWithToolCalls]) as any[]
    const content = mapped[0].content as any[]
    expect(content.find((b: any) => b.text).text).toBe('Let me call a tool')
    expect(content.find((b: any) => b.toolUse).toolUse.toolUseId).toBe('call_1')
    expect(content.find((b: any) => b.toolUse).toolUse.input).toEqual({ x: 1 })
  })

  it('omits empty text block when assistant has toolCalls but no content', () => {
    const mapped = p().mapMessages([{ role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_2', name: 'other_tool', arguments: '{}' }] }]) as any[]
    expect(mapped[0].content.find((b: any) => b.toolUse)).toBeDefined()
    expect(mapped[0].content.some((b: any) => b.text === '')).toBe(false)
  })

  it('maps tools to Bedrock toolSpec format', () => {
    const mapped = p().mapTools([testTool]) as any[]
    expect(mapped[0].toolSpec.name).toBe('test_tool')
    expect(mapped[0].toolSpec.description).toBe('A test tool')
    expect(mapped[0].toolSpec.inputSchema.json).toEqual(testTool.inputSchema)
  })

  it('maps base64 image, extracting format from mediaType', () => {
    const mapped = p().mapContentParts([base64ImagePart]) as any[]
    expect(mapped[0].image.format).toBe('png')
  })

  it('normalizes image/jpg mediaType to jpeg format', () => {
    const mapped = p().mapContentParts([{ type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/jpg', data: 'abc123' } }]) as any[]
    expect(mapped[0].image.format).toBe('jpeg')
  })

  it('falls back to text for URL images', () => {
    const mapped = p().mapContentParts([urlImagePart]) as any[]
    expect(mapped[0].text).toContain('https://example.com/img.png')
  })

  it('maps toolUse response to IMessage with serialized arguments', () => {
    const result = p().mapResponseToMessage({
      role: 'assistant',
      content: [{ text: 'Using tool' }, { toolUse: { toolUseId: 'call_1', name: 'my_tool', input: { q: 'test' } } }],
    } as any)
    expect(result.content).toBe('Using tool')
    expect(result.toolCalls![0]!.arguments).toBe('{"q":"test"}')
  })

  it('handles undefined response message gracefully', () => {
    const result = p().mapResponseToMessage(undefined)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('')
  })

  it('maps file/document content part as text placeholder', () => {
    const mapped = p().mapContentParts([filePart]) as any[]
    expect(mapped[0].text).toContain('application/pdf')
  })

  it('maps user string message to content array with text block', () => {
    const mapped = p().mapMessages([{ role: 'user', content: 'hello' }]) as any[]
    expect(mapped[0].content[0].text).toBe('hello')
  })

  it('maps user array content through mapContentParts', () => {
    const mapped = p().mapMessages([{ role: 'user' as const, content: [{ type: 'text' as const, text: 'look at this' }] }]) as any[]
    expect(mapped[0].content[0].text).toBe('look at this')
  })

  it('maps assistant with array content and toolCalls', () => {
    const mapped = p().mapMessages([assistantArrayContent]) as any[]
    expect(mapped[0].content.some((b: any) => b.text)).toBe(true)
    expect(mapped[0].content.some((b: any) => b.toolUse)).toBe(true)
  })
})

describe('BedrockProvider - thinking', () => {
  it('includes additionalModelRequestFields when thinking is set', () => {
    const params = p().buildParams({ model: 'anthropic.claude-3-7-sonnet', messages: [{ role: 'user', content: 'hi' }], thinking: 'high' })
    expect(params.additionalModelRequestFields).toEqual({ thinking: { type: 'enabled', budget_tokens: 32000 } })
  })

  it('does not include additionalModelRequestFields when thinking is not set', () => {
    expect(p().buildParams({ model: 'x', messages: [] }).additionalModelRequestFields).toBeUndefined()
  })

  it('maps low thinking to 1000 tokens', () => {
    expect((p().buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }], thinking: 'low' }) as any).additionalModelRequestFields.thinking.budget_tokens).toBe(1000)
  })
})

describe('BedrockProvider - buildParams', () => {
  it('includes system text when system messages present', () => {
    const params = p().buildParams({ model: 'x', messages: [{ role: 'system', content: 'Be helpful' }, { role: 'user', content: 'hi' }] }) as any
    expect(params.system[0].text).toBe('Be helpful')
  })

  it('includes toolConfig when tools provided', () => {
    const params = p().buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'tool', description: 'desc', inputSchema: {}, execute: async () => ({}) }] }) as any
    expect(params.toolConfig.tools).toHaveLength(1)
  })

  it('uses providerOptions maxTokens', () => {
    expect(p().buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }], providerOptions: { maxTokens: 8192 } }).inferenceConfig.maxTokens).toBe(8192)
  })

  it('defaults maxTokens to 4096', () => {
    expect(p().buildParams({ model: 'x', messages: [{ role: 'user', content: 'hi' }] }).inferenceConfig.maxTokens).toBe(4096)
  })
})

describe('BedrockProvider - chat()', () => {
  beforeEach(() => mockClientSend.mockReset())

  it('calls client and returns mapped response with usage', async () => {
    mockClientSend.mockResolvedValue({
      output: { message: { role: 'assistant', content: [{ text: 'Hello from Bedrock' }] } },
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    const result = await p().chat({ model: 'anthropic.claude-3', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.message.content).toBe('Hello from Bedrock')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })
})

describe('BedrockProvider - stream()', () => {
  beforeEach(() => mockClientSend.mockReset())
  const req = streamReq('x')

  it('yields text deltas and done with usage', async () => {
    mockClientSend.mockResolvedValue({ stream: (async function* () {
      yield { contentBlockDelta: { delta: { text: 'Hello' } } }
      yield { contentBlockDelta: { delta: { text: ' World' } } }
      yield { metadata: { usage: { inputTokens: 10, outputTokens: 5 } } }
      yield { messageStop: {} }
    })() })
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1]).toEqual({ type: 'text', delta: ' World' })
    expect(chunks[2].type).toBe('done')
    expect(chunks[2].usage).toEqual({ inputTokens: 10, outputTokens: 5 })
  })

  it('yields tool call events from stream', async () => {
    mockClientSend.mockResolvedValue({ stream: (async function* () {
      yield { contentBlockStart: { start: { toolUse: { toolUseId: 'tc_1', name: 'read_file' } } } }
      yield { contentBlockDelta: { delta: { toolUse: { input: '{"path":"x"}' } } } }
      yield { messageStop: {} }
    })() })
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'read_file' })
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"x"}' })
  })

  it('emits done even when stream ends without messageStop', async () => {
    mockClientSend.mockResolvedValue({ stream: (async function* () {
      yield { contentBlockDelta: { delta: { text: 'Hello' } } }
      yield { metadata: { usage: { inputTokens: 5, outputTokens: 3 } } }
    })() })
    const chunks = await collectChunks(p().stream(req))
    expect(chunks.at(-1)?.type).toBe('done')
  })

  it('returns early when no stream', async () => {
    mockClientSend.mockResolvedValue({})
    const chunks = await collectChunks(p().stream(req))
    expect(chunks).toHaveLength(0)
  })
})
