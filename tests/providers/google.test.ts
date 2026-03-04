import { describe, it, expect } from 'bun:test'
import { GoogleProvider } from '../../src/providers/google'
import { extractSystemMessages } from '../../src/providers/utils'

describe('GoogleProvider', () => {
  it('extracts system messages from message array', () => {
    const messages = [
      { role: 'system' as const, content: 'You are helpful' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { system, filtered } = extractSystemMessages(messages)
    expect(system).toBe('You are helpful')
    expect(filtered).toHaveLength(1)
    expect(filtered[0]?.role).toBe('user')
  })

  it('extracts multiple system messages joined with newline', () => {
    const messages = [
      { role: 'system' as const, content: 'First instruction' },
      { role: 'system' as const, content: 'Second instruction' },
      { role: 'user' as const, content: 'hello' },
    ]
    const { system, filtered } = extractSystemMessages(messages)
    expect(system).toBe('First instruction\nSecond instruction')
    expect(filtered).toHaveLength(1)
  })

  it('maps user messages to Gemini format with user role', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'user' as const, content: 'hello' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('user')
    expect(mapped[0].parts[0].text).toBe('hello')
  })

  it('maps assistant messages to Gemini format with model role', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'assistant' as const, content: 'I can help' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('model')
    expect(mapped[0].parts[0].text).toBe('I can help')
  })

  it('maps image content parts to inlineData format', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'Look at this' },
          { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc123' } },
        ],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].parts[0].text).toBe('Look at this')
    expect(mapped[0].parts[1].inlineData).toBeDefined()
    expect(mapped[0].parts[1].inlineData.mimeType).toBe('image/png')
    expect(mapped[0].parts[1].inlineData.data).toBe('abc123')
  })

  it('maps tools to Gemini functionDeclarations format', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const tools = [{
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
      execute: async () => ({}),
    }]
    const mapped = (provider as any).mapTools(tools)
    expect(mapped).toHaveLength(1)
    expect(mapped[0].functionDeclarations).toHaveLength(1)
    expect(mapped[0].functionDeclarations[0].name).toBe('test_tool')
    expect(mapped[0].functionDeclarations[0].description).toBe('A test tool')
    expect(mapped[0].functionDeclarations[0].parameters).toEqual({ type: 'object', properties: { x: { type: 'number' } } })
  })

  it('handles malformed JSON in toolCall arguments gracefully', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{broken json' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    const fcPart = mapped[0].parts.find((p: any) => p.functionCall)
    expect(fcPart).toBeDefined()
    expect(fcPart.functionCall.args).toEqual({})
  })

  it('maps assistant messages with toolCalls to functionCall parts', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('model')
    const fcPart = mapped[0].parts.find((p: any) => p.functionCall)
    expect(fcPart).toBeDefined()
    expect(fcPart.functionCall.name).toBe('test_tool')
    expect(fcPart.functionCall.args).toEqual({ x: 1 })
  })

  it('maps tool result messages to functionResponse parts', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'result text', toolCallId: 'read_file_0' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('user')
    const frPart = mapped[0].parts.find((p: any) => p.functionResponse)
    expect(frPart).toBeDefined()
    expect(frPart.functionResponse.name).toBe('read_file')
    expect(frPart.functionResponse.response.content).toBe('result text')
  })

  it('maps Gemini response back to IMessage', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const geminiResponse = {
      candidates: [{
        content: {
          role: 'model',
          parts: [{ text: 'Hello there' }],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }
    const result = (provider as any).mapResponseToMessage(geminiResponse)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('Hello there')
    expect(result.toolCalls).toBeUndefined()
  })

  it('maps Gemini response with functionCall to toolCalls', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const geminiResponse = {
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { functionCall: { name: 'test_tool', args: { x: 1 } } },
          ],
        },
      }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    }
    const result = (provider as any).mapResponseToMessage(geminiResponse)
    expect(result.role).toBe('assistant')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('test_tool')
    expect(result.toolCalls[0].arguments).toBe('{"x":1}')
  })

  describe('thinking', () => {
    it('builds thinkingConfig for medium', () => {
      const provider = new GoogleProvider({ apiKey: 'test' })
      const genConfig = (provider as any).buildThinkingConfig('medium')
      expect(genConfig).toEqual({ thinkingBudget: 4096 })
    })

    it('returns undefined when thinking not set', () => {
      const provider = new GoogleProvider({ apiKey: 'test' })
      const genConfig = (provider as any).buildThinkingConfig(undefined)
      expect(genConfig).toBeUndefined()
    })

    it('maps low to 512', () => {
      const provider = new GoogleProvider({ apiKey: 'test' })
      expect((provider as any).buildThinkingConfig('low')).toEqual({ thinkingBudget: 512 })
    })

    it('maps high to 16384', () => {
      const provider = new GoogleProvider({ apiKey: 'test' })
      expect((provider as any).buildThinkingConfig('high')).toEqual({ thinkingBudget: 16384 })
    })
  })

  it('maps URL image to fileData format', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const parts = [
      { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.jpg' } },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].fileData).toBeDefined()
    expect(mapped[0].fileData.fileUri).toBe('https://example.com/img.jpg')
  })

  it('maps file/document content parts to inlineData', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: 'base64data' },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].inlineData).toBeDefined()
    expect(mapped[0].inlineData.mimeType).toBe('application/pdf')
  })

  it('maps file content parts with Buffer data', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const parts = [
      { type: 'file' as const, mimeType: 'application/pdf', data: Buffer.from('pdfdata') },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].inlineData.data).toBe(Buffer.from('pdfdata').toString('base64'))
  })

  it('maps assistant with text content and toolCalls', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: 'Let me help',
        toolCalls: [{ id: 'call_1', name: 'tool', arguments: '{}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].role).toBe('model')
    expect(mapped[0].parts.some((p: any) => p.text === 'Let me help')).toBe(true)
    expect(mapped[0].parts.some((p: any) => p.functionCall)).toBe(true)
  })

  it('maps assistant with array content and toolCalls', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'here' }],
        toolCalls: [{ id: 'call_1', name: 'tool', arguments: '{}' }],
      },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].parts.some((p: any) => p.text === 'here')).toBe(true)
    expect(mapped[0].parts.some((p: any) => p.functionCall)).toBe(true)
  })

  it('maps user message with array content parts', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'look at this' }] },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].parts[0].text).toBe('look at this')
  })

  it('maps response with no candidates gracefully', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const result = (provider as any).mapResponseToMessage({ candidates: [] })
    expect(result.role).toBe('assistant')
    expect(result.content).toBe('')
  })

})

describe('GoogleProvider - chat()', () => {
  it('calls model and returns mapped response with usage', async () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      getGenerativeModel: () => ({
        generateContent: async () => ({
          response: {
            candidates: [{ content: { role: 'model', parts: [{ text: 'Hello from Gemini' }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          },
        }),
      }),
    }
    const result = await provider.chat({
      model: 'gemini-pro',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.message.role).toBe('assistant')
    expect(result.message.content).toBe('Hello from Gemini')
    expect(result.usage?.inputTokens).toBe(10)
  })

  it('passes tools and thinkingConfig when provided', async () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    let capturedArgs: any = null
    ;(provider as any).client = {
      getGenerativeModel: () => ({
        generateContent: async (args: any) => {
          capturedArgs = args
          return {
            response: {
              candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] } }],
            },
          }
        },
      }),
    }
    await provider.chat({
      model: 'gemini-pro',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'tool', description: 'desc', inputSchema: {}, execute: async () => ({}) }],
      thinking: 'medium',
    })
    expect(capturedArgs.tools).toBeDefined()
    expect(capturedArgs.generationConfig).toBeDefined()
  })
})

describe('GoogleProvider - stream()', () => {
  it('yields text deltas and done with usage', async () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      getGenerativeModel: () => ({
        generateContentStream: async () => ({
          stream: (async function* () {
            yield { candidates: [{ content: { parts: [{ text: 'Hello' }] } }] }
            yield { candidates: [{ content: { parts: [{ text: ' World' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }
          })(),
        }),
      }),
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gemini-pro', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'text', delta: 'Hello' })
    expect(chunks[1]).toEqual({ type: 'text', delta: ' World' })
    expect(chunks[2].type).toBe('done')
    expect(chunks[2].usage.inputTokens).toBe(10)
  })

  it('yields thinking deltas for thought parts', async () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      getGenerativeModel: () => ({
        generateContentStream: async () => ({
          stream: (async function* () {
            yield { candidates: [{ content: { parts: [{ thought: true, text: 'Let me think...' }] } }] }
            yield { candidates: [{ content: { parts: [{ text: 'Answer here' }] } }] }
          })(),
        }),
      }),
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gemini-pro', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'thinking', delta: 'Let me think...' })
    expect(chunks[1]).toEqual({ type: 'text', delta: 'Answer here' })
  })

  it('yields tool call events for functionCall parts', async () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      getGenerativeModel: () => ({
        generateContentStream: async () => ({
          stream: (async function* () {
            yield { candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'x' } } }] } }] }
          })(),
        }),
      }),
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gemini-pro', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    expect(chunks[0]).toEqual({ type: 'tool_call_start', id: 'read_file_0', name: 'read_file' })
    expect(chunks[1].type).toBe('tool_call_delta')
    expect(chunks[2]).toEqual({ type: 'tool_call_end', id: 'read_file_0' })
  })

  it('assigns unique IDs when same tool is called multiple times', async () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    ;(provider as any).client = {
      getGenerativeModel: () => ({
        generateContentStream: async () => ({
          stream: (async function* () {
            yield { candidates: [{ content: { parts: [
              { functionCall: { name: 'read_file', args: { path: 'a.ts' } } },
              { functionCall: { name: 'read_file', args: { path: 'b.ts' } } },
            ] } }] }
          })(),
        }),
      }),
    }
    const chunks: any[] = []
    for await (const chunk of provider.stream({ model: 'gemini-pro', messages: [{ role: 'user', content: 'hi' }] })) {
      chunks.push(chunk)
    }
    const starts = chunks.filter(c => c.type === 'tool_call_start')
    expect(starts).toHaveLength(2)
    expect(starts[0].id).toBe('read_file_0')
    expect(starts[1].id).toBe('read_file_1')
    expect(starts[0].id).not.toBe(starts[1].id)
  })
})

describe('GoogleProvider - additional bug fixes', () => {
  it('extracts tool name correctly when name contains digits', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'result', toolCallId: 'get_result_3_0' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].parts[0].functionResponse.name).toBe('get_result_3')
  })

  it('excludes thought parts from textContent in mapResponseToMessage', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const response = {
      candidates: [{ content: { parts: [
        { thought: true, text: 'thinking...' },
        { text: 'actual response' },
      ] } }],
    }
    const msg = (provider as any).mapResponseToMessage(response as any)
    expect(msg.content).toBe('actual response')
    expect((msg.content as string)).not.toContain('thinking')
  })

  it('infers image mime type from URL extension', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const parts = [
      { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/photo.png' } },
    ]
    const mapped = (provider as any).mapContentParts(parts)
    expect(mapped[0].fileData.mimeType).toBe('image/png')
  })
})

describe('GoogleProvider - tool result ID mapping', () => {
  it('strips counter suffix from toolCallId for functionResponse name', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const messages = [
      { role: 'tool' as const, content: 'file contents', toolCallId: 'read_file_0' },
      { role: 'tool' as const, content: 'more contents', toolCallId: 'read_file_1' },
    ]
    const mapped = (provider as any).mapMessages(messages)
    expect(mapped[0].parts[0].functionResponse.name).toBe('read_file')
    expect(mapped[1].parts[0].functionResponse.name).toBe('read_file')
  })

  it('mapResponseToMessage assigns unique IDs for duplicate function calls', () => {
    const provider = new GoogleProvider({ apiKey: 'test' })
    const response = {
      candidates: [{
        content: {
          role: 'model',
          parts: [
            { functionCall: { name: 'search', args: { q: 'a' } } },
            { functionCall: { name: 'search', args: { q: 'b' } } },
          ],
        },
      }],
    }
    const result = (provider as any).mapResponseToMessage(response)
    expect(result.toolCalls).toHaveLength(2)
    expect(result.toolCalls[0].id).toBe('search_0')
    expect(result.toolCalls[1].id).toBe('search_1')
    expect(result.toolCalls[0].id).not.toBe(result.toolCalls[1].id)
  })
})
