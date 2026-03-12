import { describe, it, expect, mock, beforeEach } from 'bun:test'
import {
  testTool, base64ImagePart, urlImagePart, filePart, fileBufferPart,
  toolMessage, assistantWithToolCalls, assistantMalformedArgs, assistantArrayContent, userArrayContent,
  collectChunks, streamReq, testMalformedJsonArgs,
} from './shared-provider-tests'

const mockGenerateContent = mock()
const mockGenerateContentStream = mock()
mock.module('@google/generative-ai', () => ({
  GoogleGenerativeAI: class MockGoogleGenerativeAI {
    getGenerativeModel() {
      return { generateContent: mockGenerateContent, generateContentStream: mockGenerateContentStream }
    }
  },
}))

import { GoogleProvider } from '../../src/providers/google'
import { extractSystemMessages } from '../../src/providers/utils'

const p = () => new GoogleProvider({ apiKey: 'test' })

describe('GoogleProvider', () => {
  it('extracts system messages from message array', () => {
    const { system, filtered } = extractSystemMessages([{ role: 'system', content: 'You are helpful' }, { role: 'user', content: 'hello' }])
    expect(system).toBe('You are helpful')
    expect(filtered).toHaveLength(1)
  })

  it('extracts multiple system messages joined with newline', () => {
    const { system } = extractSystemMessages([{ role: 'system', content: 'First instruction' }, { role: 'system', content: 'Second instruction' }, { role: 'user', content: 'hello' }])
    expect(system).toBe('First instruction\nSecond instruction')
  })

  it('maps user messages with user role', () => {
    const mapped = p().mapMessages([{ role: 'user', content: 'hello' }]) as any[]
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].parts[0].text).toBe('hello')
  })

  it('maps assistant messages with model role', () => {
    const mapped = p().mapMessages([{ role: 'assistant', content: 'I can help' }]) as any[]
    expect(mapped[0].role).toBe('model')
    expect(mapped[0].parts[0].text).toBe('I can help')
  })

  it('maps image content parts to inlineData format', () => {
    const mapped = p().mapMessages([{ role: 'user', content: [{ type: 'text' as const, text: 'Look at this' }, base64ImagePart] }]) as any[]
    expect(mapped[0].parts[0].text).toBe('Look at this')
    expect(mapped[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'abc' })
  })

  it('maps tools to Gemini functionDeclarations format', () => {
    const mapped = p().mapTools([testTool]) as any[]
    expect(mapped[0].functionDeclarations[0].name).toBe('test_tool')
    expect(mapped[0].functionDeclarations[0].description).toBe('A test tool')
    expect(mapped[0].functionDeclarations[0].parameters).toEqual(testTool.inputSchema)
  })

  testMalformedJsonArgs(p(), (mapped) => {
    const fcPart = mapped[0].parts.find((p: any) => p.functionCall)
    return fcPart!.functionCall.args
  })

  it('maps assistant messages with toolCalls to functionCall parts', () => {
    const mapped = p().mapMessages([assistantWithToolCalls]) as any[]
    expect(mapped[0].role).toBe('model')
    const fc = mapped[0].parts.find((p: any) => p.functionCall)
    expect(fc.functionCall.name).toBe('test_tool')
    expect(fc.functionCall.args).toEqual({ x: 1 })
  })

  it('maps tool result messages to functionResponse parts', () => {
    const mapped = p().mapMessages([{ role: 'tool' as const, content: 'result text', toolCallId: 'read_file_0' }]) as any[]
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].parts[0].functionResponse.name).toBe('read_file')
    expect(mapped[0].parts[0].functionResponse.response.content).toBe('result text')
  })

  it('maps Gemini response back to IMessage', () => {
    const result = p().mapResponseToMessage({
      candidates: [{ content: { role: 'model', parts: [{ text: 'Hello there' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    } as any)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello there')
    expect(result.toolCalls).toBeUndefined()
  })

  it('maps Gemini response with functionCall to toolCalls', () => {
    const result = p().mapResponseToMessage({
      candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'test_tool', args: { x: 1 } } }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    } as any)
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.name).toBe('test_tool')
    expect(result.toolCalls![0]!.arguments).toBe('{"x":1}')
  })

  it('maps URL image to fileData format', () => {
    const mapped = p().mapContentParts([urlImagePart]) as any[]
    expect(mapped[0].fileData.fileUri).toBe('https://example.com/img.png')
  })

  it('maps file/document content parts to inlineData', () => {
    const mapped = p().mapContentParts([filePart]) as any[]
    expect(mapped[0].inlineData.mimeType).toBe('application/pdf')
  })

  it('maps file content parts with Buffer data', () => {
    const mapped = p().mapContentParts([fileBufferPart]) as any[]
    expect(mapped[0].inlineData.data).toBe(Buffer.from('pdfdata').toString('base64'))
  })

  it('maps assistant with text content and toolCalls', () => {
    const mapped = p().mapMessages([{ role: 'assistant' as const, content: 'Let me help', toolCalls: [{ id: 'call_1', name: 'tool', arguments: '{}' }] }]) as any[]
    expect(mapped[0].parts.some((p: any) => p.text === 'Let me help')).toBe(true)
    expect(mapped[0].parts.some((p: any) => p.functionCall)).toBe(true)
  })

  it('maps assistant with array content and toolCalls', () => {
    const mapped = p().mapMessages([assistantArrayContent]) as any[]
    expect(mapped[0].parts.some((p: any) => p.text)).toBe(true)
    expect(mapped[0].parts.some((p: any) => p.functionCall)).toBe(true)
  })

  it('maps user message with array content parts', () => {
    const mapped = p().mapMessages([userArrayContent]) as any[]
    expect(mapped[0].parts[0].text).toBe('hello')
  })

  it('maps response with no candidates gracefully', () => {
    const result = p().mapResponseToMessage({ candidates: [] } as any)
    expect(result.content).toBe('')
  })

  it('accepts baseURL option without error', () => {
    expect(() => new GoogleProvider({ apiKey: 'test', baseURL: 'http://localhost:9999' })).not.toThrow()
  })
})

describe('GoogleProvider - thinking', () => {
  it('builds thinkingConfig for medium', () => {
    expect(p().buildThinkingConfig('medium')).toEqual({ thinkingBudget: 4096 })
  })
  it('returns undefined when not set', () => {
    expect(p().buildThinkingConfig(undefined)).toBeUndefined()
  })
  it('maps low to 512', () => {
    expect(p().buildThinkingConfig('low')).toEqual({ thinkingBudget: 512 })
  })
  it('maps high to 16384', () => {
    expect(p().buildThinkingConfig('high')).toEqual({ thinkingBudget: 16384 })
  })
})

describe('GoogleProvider - empty content handling', () => {
  it('does not create empty text parts for assistant with empty content', () => {
    const mapped = p().mapMessages([{ role: 'assistant', content: '' }]) as any[]
    expect(mapped[0].parts).toHaveLength(0)
  })
  it('does not create empty text parts for user with empty content', () => {
    const mapped = p().mapMessages([{ role: 'user', content: '' }]) as any[]
    expect(mapped[0].parts).toHaveLength(0)
  })
})

describe('GoogleProvider - chat()', () => {
  beforeEach(() => mockGenerateContent.mockReset())

  it('calls model and returns mapped response with usage', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { candidates: [{ content: { role: 'model', parts: [{ text: 'Hello from Gemini' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } },
    })
    const result = await p().chat({ model: 'gemini-pro', messages: [{ role: 'user', content: 'hi' }] })
    expect(result.message.content).toBe('Hello from Gemini')
    expect(result.usage?.inputTokens).toBe(10)
  })

  it('passes tools and thinkingConfig when provided', async () => {
    let capturedArgs: any = null
    mockGenerateContent.mockImplementation(async (args: any) => {
      capturedArgs = args
      return { response: { candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }] } }
    })
    await p().chat({ model: 'gemini-pro', messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'tool', description: 'desc', inputSchema: {}, execute: async () => ({}) }], thinking: 'medium' })
    expect(capturedArgs.tools).toBeDefined()
    expect(capturedArgs.generationConfig).toBeDefined()
  })
})

describe('GoogleProvider - stream()', () => {
  beforeEach(() => mockGenerateContentStream.mockReset())
  const req = streamReq('gemini-pro')

  it('yields text deltas and done with usage', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: (async function* () {
      yield { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] }
      yield { candidates: [{ content: { parts: [{ text: ' World' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }
    })() })
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1]).toEqual({ type: 'text', delta: ' World' })
    expect(chunks[2].type).toBe('done')
    expect(chunks[2].usage.inputTokens).toBe(10)
  })

  it('yields thinking deltas for thought parts', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: (async function* () {
      yield { candidates: [{ content: { parts: [{ thought: true, text: 'Let me think...' }] } }] }
      yield { candidates: [{ content: { parts: [{ text: 'Answer here' }] } }] }
    })() })
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Let me think...' })
    expect(chunks[1]).toEqual({ type: 'text', delta: 'Answer here' })
  })

  it('yields tool call events for functionCall parts', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: (async function* () {
      yield { candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'x' } } }] } }] }
    })() })
    const chunks = await collectChunks(p().stream(req))
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'read_file_0', name: 'read_file' })
    expect(chunks[1].type).toBe('tool_call_delta')
    expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'read_file_0' })
  })

  it('assigns unique IDs when same tool is called multiple times', async () => {
    mockGenerateContentStream.mockResolvedValue({ stream: (async function* () {
      yield { candidates: [{ content: { parts: [
        { functionCall: { name: 'read_file', args: { path: 'a.ts' } } },
        { functionCall: { name: 'read_file', args: { path: 'b.ts' } } },
      ] } }] }
    })() })
    const chunks = await collectChunks(p().stream(req))
    const starts = chunks.filter(c => c.type === 'tool_call_start')
    expect(starts).toHaveLength(2)
    expect(starts[0].id).toBe('read_file_0')
    expect(starts[1].id).toBe('read_file_1')
  })
})

describe('GoogleProvider - additional', () => {
  it('extracts tool name correctly when name contains digits', () => {
    const mapped = p().mapMessages([{ role: 'tool' as const, content: 'result', toolCallId: 'get_result_3_0' }]) as any[]
    expect(mapped[0].parts[0].functionResponse.name).toBe('get_result_3')
  })

  it('excludes thought parts from textContent in mapResponseToMessage', () => {
    const msg = p().mapResponseToMessage({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking...' }, { text: 'actual response' }] } }] } as any)
    expect(msg.content).toBe('actual response')
  })

  it('infers image mime type from URL extension', () => {
    const mapped = p().mapContentParts([{ type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/photo.png' } }]) as any[]
    expect(mapped[0].fileData.mimeType).toBe('image/png')
  })

  it('strips counter suffix from toolCallId for functionResponse name', () => {
    const mapped = p().mapMessages([
      { role: 'tool' as const, content: 'file contents', toolCallId: 'read_file_0' },
      { role: 'tool' as const, content: 'more contents', toolCallId: 'read_file_1' },
    ]) as any[]
    expect(mapped[0].parts[0].functionResponse.name).toBe('read_file')
    expect(mapped[1].parts[0].functionResponse.name).toBe('read_file')
  })

  it('mapResponseToMessage assigns unique IDs for duplicate function calls', () => {
    const result = p().mapResponseToMessage({
      candidates: [{ content: { role: 'model', parts: [
        { functionCall: { name: 'search', args: { q: 'a' } } },
        { functionCall: { name: 'search', args: { q: 'b' } } },
      ] } }],
    } as any)
    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls![0]!.id).toBe('search_0')
    expect(result.toolCalls![1]!.id).toBe('search_1')
  })
})
