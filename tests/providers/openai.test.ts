import { describe, it, expect, mock, beforeEach } from 'bun:test'
import {
  testTool, textPart, base64ImagePart, urlImagePart, filePart,
  toolMessage, assistantWithToolCalls, collectChunks, streamReq,
  testBuildParamsWithTools, testBuildParamsMergesOptions, testMalformedJsonArgs,
  testMapResponseTextOnly, userArrayContent,
} from './shared-provider-tests'

const mockCompletionsCreate = mock()
mock.module('openai', () => ({
  default: class MockOpenAI { chat = { completions: { create: mockCompletionsCreate } } },
}))

import { OpenAIProvider } from '../../src/providers/openai'

const p = () => new OpenAIProvider({ apiKey: 'test' })

describe('OpenAIProvider', () => {
  it('keeps system messages in array', () => {
    const mapped = p().mapMessages([{ role: 'system', content: 'You are helpful' }, { role: 'user', content: 'hello' }]) as any[]
    expect(mapped[0].role).toBe('system')
    expect(mapped).toHaveLength(2)
  })

  it('maps tools to OpenAI format', () => {
    const mapped = p().mapTools([testTool]) as any[]
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].function.name).toBe('test_tool')
  })

  it('maps tool messages with tool_call_id', () => {
    const mapped = p().mapMessages([toolMessage]) as any[]
    expect(mapped[0].role).toBe('tool')
    expect(mapped[0].tool_call_id).toBe('call_123')
    expect(mapped[0].content).toBe('result text')
  })

  it('maps assistant messages with toolCalls to tool_calls array', () => {
    const mapped = p().mapMessages([assistantWithToolCalls]) as any[]
    expect(mapped[0].role).toBe('assistant')
    expect(mapped[0].tool_calls).toHaveLength(1)
    expect(mapped[0].tool_calls[0].id).toBe('call_1')
    expect(mapped[0].tool_calls[0].type).toBe('function')
    expect(mapped[0].tool_calls[0].function.name).toBe('test_tool')
    expect(mapped[0].tool_calls[0].function.arguments).toBe('{"x":1}')
  })

  it('maps OpenAI response back to IMessage', () => {
    const result = p().mapResponseToMessage({
      role: 'assistant', content: 'Hello',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'test_tool', arguments: '{"x":1}' } }],
    } as any)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.id).toBe('call_1')
    expect(result.toolCalls![0]!.arguments).toBe('{"x":1}')
  })

  it('maps content parts correctly', () => {
    const mapped = p().mapContentParts([textPart, base64ImagePart, urlImagePart]) as any[]
    expect(mapped[0]).toEqual({ type: 'text', text: 'hello' })
    expect(mapped[1].type).toBe('image_url')
    expect(mapped[1].image_url.url).toBe('data:image/png;base64,abc')
    expect(mapped[2].image_url.url).toBe('https://example.com/img.png')
  })

  it('maps file content part as text placeholder', () => {
    const mapped = p().mapContentParts([filePart]) as any[]
    expect(mapped[0].type).toBe('text')
    expect(mapped[0].text).toContain('application/pdf')
  })

  testBuildParamsWithTools(p(), 'gpt-4o')
  testBuildParamsMergesOptions(p(), 'gpt-4o', 'temperature', 0.5, 'temperature')

  testMapResponseTextOnly(p(), { role: 'assistant', content: null, tool_calls: undefined } as any, '')

  it('maps system message with array content to joined text', () => {
    const mapped = p().mapMessages([{ role: 'system' as const, content: [{ type: 'text' as const, text: 'hello ' }, { type: 'text' as const, text: 'world' }] }]) as any[]
    expect(mapped[0].content).toBe('hello world')
  })

  it('maps assistant with array content to joined text', () => {
    const mapped = p().mapMessages([{ role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hello' }] }]) as any[]
    expect(mapped[0].content).toBe('hello')
  })

  it('maps user message with array content parts', () => {
    const mapped = p().mapMessages([{ role: 'user' as const, content: [{ type: 'text' as const, text: 'look' }, { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.png' } }] }]) as any[]
    expect(mapped[0].content).toHaveLength(2)
  })
})

describe('thinking / reasoning effort', () => {
  it('adds reasoning effort to buildParams when thinking is set', () => {
    expect((p().buildParams({ model: 'o3', messages: [{ role: 'user', content: 'hi' }], thinking: 'medium' }) as any).reasoning).toEqual({ effort: 'medium' })
  })

  it('does not add reasoning when thinking is not set', () => {
    expect((p().buildParams({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }) as any).reasoning).toBeUndefined()
  })
})

describe('OpenAIProvider - toUsage', () => {
  it('maps usage with reasoning tokens', () => {
    const usage = p().toUsage({ prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 } })
    expect(usage).toEqual({ inputTokens: 100, outputTokens: 50, thinkingTokens: 20 })
  })

  it('maps usage without reasoning tokens', () => {
    const usage = p().toUsage({ prompt_tokens: 100, completion_tokens: 50 })
    expect(usage.thinkingTokens).toBeUndefined()
  })
})

describe('OpenAIProvider - chat()', () => {
  beforeEach(() => mockCompletionsCreate.mockReset())

  it('calls client and returns mapped response with usage', async () => {
    mockCompletionsCreate.mockResolvedValue({
      choices: [{ message: { role: 'assistant', content: 'Hello from chat' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const result = await p().chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.message.content).toBe('Hello from chat')
    expect(result.usage?.inputTokens).toBe(10)
  })

  it('returns undefined usage when not present in response', async () => {
    mockCompletionsCreate.mockResolvedValue({ choices: [{ message: { role: 'assistant', content: 'Hi' } }] })
    expect((await p().chat({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })).usage).toBeUndefined()
  })
})

describe('OpenAIProvider - stream()', () => {
  beforeEach(() => mockCompletionsCreate.mockReset())
  const req = streamReq('gpt-4o')

  it('yields text deltas and done with usage', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1].type).toBe('done')
    expect(chunks[1].usage.inputTokens).toBe(10)
  })

  it('yields tool_call_start and tool_call_delta', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'tc_1', function: { name: 'read_file' } }] } }] }
      yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"x"}' } }] } }] }
      yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'tc_1', name: 'read_file' })
    expect(chunks[1]).toEqual({ type: 'tool_call_delta', id: 'tc_1', argsDelta: '{"path":"x"}' })
    expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'tc_1' })
  })

  it('skips chunks with no delta', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{}] }
      yield { choices: [{ delta: { content: 'text' } }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'text', delta: 'text' })
  })

  it('captures usage from terminal empty-choices chunk', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] }
      yield { choices: [{ delta: {}, finish_reason: 'stop' }] }
      yield { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }
    })())
    const chunks = await collectChunks(p().stream(req))
    const done = chunks.find((c: any) => c.type === 'done')
    expect(done.usage.inputTokens).toBe(10)
  })

  it('emits done even when stream ends without finish_reason', async () => {
    mockCompletionsCreate.mockResolvedValue((async function* () {
      yield { choices: [{ delta: { content: 'Hello' } }] }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks.at(-1)?.type).toBe('done')
  })
})

describe('OpenAIProvider - extensibility', () => {
  it('allows subclass to override buildParams', () => {
    class TestProvider extends OpenAIProvider {
      override buildParams(request: any) { return { ...super.buildParams(request), model: 'overridden' } }
    }
    expect(new TestProvider({ apiKey: 'test' }).buildParams({ model: 'original', messages: [{ role: 'user', content: 'hi' }] }).model).toBe('overridden')
  })
})
