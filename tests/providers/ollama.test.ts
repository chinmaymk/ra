import { describe, it, expect, mock, beforeEach } from 'bun:test'
import {
  testTool, toolMessage, assistantWithToolCalls, assistantMalformedArgs,
  userArrayContent, collectChunks, streamReq, testBuildParamsWithTools,
  testBuildParamsMergesOptions, testMalformedJsonArgs,
} from './shared-provider-tests'

const mockOllamaChat = mock()
mock.module('ollama', () => ({
  Ollama: class MockOllama { chat = mockOllamaChat },
}))

import { OllamaProvider } from '../../src/providers/ollama'

const p = () => new OllamaProvider({ host: 'http://localhost:11434' })

describe('OllamaProvider', () => {
  it('keeps system messages as role:system', () => {
    const mapped = p().mapMessages([{ role: 'system', content: 'You are helpful' }, { role: 'user', content: 'hello' }]) as any[]
    expect(mapped[0].role).toBe('system')
    expect(mapped).toHaveLength(2)
  })

  it('maps tools to function format', () => {
    const mapped = p().mapTools([testTool]) as any[]
    expect(mapped[0].type).toBe('function')
    expect(mapped[0].function.name).toBe('test_tool')
    expect(mapped[0].function.description).toBe('A test tool')
    expect(mapped[0].function.parameters).toEqual(testTool.inputSchema)
  })

  it('maps tool messages with toolCallId', () => {
    const mapped = p().mapMessages([toolMessage]) as any[]
    expect(mapped[0].role).toBe('tool')
    expect(mapped[0].content).toBe('result text')
  })

  it('maps assistant messages with toolCalls', () => {
    const mapped = p().mapMessages([{ role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }] }]) as any[]
    expect(mapped[0].tool_calls).toHaveLength(1)
    expect(mapped[0].tool_calls[0].function.name).toBe('test_tool')
    expect(mapped[0].tool_calls[0].function.arguments).toEqual({ x: 1 })
  })

  it('maps Ollama response back to IMessage', () => {
    const result = p().mapResponseToMessage({ role: 'assistant', content: 'Hello', tool_calls: [{ function: { name: 'test_tool', arguments: { x: 1 } } }] } as any)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello')
    expect(result.toolCalls![0]!.arguments).toBe('{"x":1}')
  })

  it('maps response without tool_calls', () => {
    const result = p().mapResponseToMessage({ role: 'assistant', content: 'Just text' } as any)
    expect(result.content).toBe('Just text')
    expect(result.toolCalls).toBeUndefined()
  })

  it('maps response with null content', () => {
    expect(p().mapResponseToMessage({ role: 'assistant', content: undefined } as any).content).toBe('')
  })

  testBuildParamsWithTools(p(), 'llama3')
  testBuildParamsMergesOptions(p(), 'llama3', 'temperature', 0.7, 'temperature')

  it('maps user message with array content to joined text', () => {
    const mapped = p().mapMessages([{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hello ' }, { type: 'text' as const, text: 'world' }] }]) as any[]
    expect(mapped[0].content).toBe('hello world')
  })

  it('maps system message with array content to joined text', () => {
    const mapped = p().mapMessages([{ role: 'system' as const, content: [{ type: 'text' as const, text: 'sys' }] }]) as any[]
    expect(mapped[0].content).toBe('sys')
  })

  it('maps tool message with non-string content to JSON', () => {
    const mapped = p().mapMessages([{ role: 'tool' as const, content: [{ type: 'text' as const, text: 'result' }], toolCallId: 'tc1' }]) as any[]
    expect(mapped[0].content).toBe(JSON.stringify([{ type: 'text', text: 'result' }]))
  })

  it('maps assistant with array content to extracted text', () => {
    const mapped = p().mapMessages([{ role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hi' }] }]) as any[]
    expect(mapped[0].content).toBe('hi')
  })

  testMalformedJsonArgs(p(), (mapped) => mapped[0].tool_calls[0].function.arguments)
})

describe('OllamaProvider - chat()', () => {
  beforeEach(() => mockOllamaChat.mockReset())

  it('calls client and returns mapped response', async () => {
    mockOllamaChat.mockResolvedValue({ message: { role: 'assistant', content: 'Hello from Ollama' } })
    const result = await p().chat({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.message.content).toBe('Hello from Ollama')
  })

  it('returns response with tool calls', async () => {
    mockOllamaChat.mockResolvedValue({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'tool', arguments: { x: 1 } } }] } })
    const result = await p().chat({ model: 'llama3', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.message.toolCalls).toHaveLength(1)
    expect(result.message.toolCalls![0]?.name).toBe('tool')
  })
})

describe('OllamaProvider - stream()', () => {
  beforeEach(() => mockOllamaChat.mockReset())
  const req = streamReq('llama3')

  it('yields text deltas and done with usage', async () => {
    mockOllamaChat.mockResolvedValue((async function* () {
      yield { message: { content: 'Hello' }, done: false }
      yield { message: { content: ' World' }, done: false }
      yield { message: {}, done: true, prompt_eval_count: 10, eval_count: 5 }
    })())
    const chunks = await collectChunks(p().stream(req))
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
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'call_0', name: 'tool' })
    expect(chunks[1].type).toBe('tool_call_delta')
    expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'call_0' })
  })

  it('skips messages with no content or tool_calls', async () => {
    mockOllamaChat.mockResolvedValue((async function* () {
      yield { message: undefined, done: false }
      yield { message: { content: 'text' }, done: false }
      yield { message: {}, done: true }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'text', delta: 'text' })
    expect(chunks[1].type).toBe('done')
  })

  it('done without eval counts yields undefined usage', async () => {
    mockOllamaChat.mockResolvedValue((async function* () {
      yield { message: {}, done: true }
    })())
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'done', usage: undefined })
  })
})
