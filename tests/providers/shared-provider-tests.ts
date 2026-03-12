import { it, expect } from 'bun:test'

/** Standard tool fixture used across all provider tests */
export const testTool = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: { type: 'object', properties: { x: { type: 'number' } } },
  execute: async () => ({}),
}

/** Minimal tool for buildParams tests */
export const minimalTool = { name: 'tool', description: 'desc', inputSchema: {}, execute: async () => ({}) }

/** Standard content parts fixtures */
export const textPart = { type: 'text' as const, text: 'hello' }
export const base64ImagePart = { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc' } }
export const urlImagePart = { type: 'image' as const, source: { type: 'url' as const, url: 'https://example.com/img.png' } }
export const filePart = { type: 'file' as const, mimeType: 'application/pdf', data: 'base64pdfdata' }
export const fileBufferPart = { type: 'file' as const, mimeType: 'application/pdf', data: Buffer.from('pdfdata') }

/** Standard messages for mapping tests */
export const toolMessage = { role: 'tool' as const, content: 'result text', toolCallId: 'call_123' }
export const assistantWithToolCalls = {
  role: 'assistant' as const,
  content: 'Let me call a tool',
  toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{"x":1}' }],
}
export const assistantMalformedArgs = {
  role: 'assistant' as const,
  content: 'calling tool',
  toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: 'not-valid-json{{{' }],
}
export const assistantArrayContent = {
  role: 'assistant' as const,
  content: [{ type: 'text' as const, text: 'looking at this' }],
  toolCalls: [{ id: 'call_1', name: 'test_tool', arguments: '{}' }],
}
export const userArrayContent = {
  role: 'user' as const,
  content: [{ type: 'text' as const, text: 'hello' }],
}

/** Helper to collect all chunks from a stream */
export async function collectChunks(stream: AsyncIterable<any>): Promise<any[]> {
  const chunks: any[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

/** Standard request for stream tests */
export const streamReq = (model: string) => ({
  model,
  messages: [{ role: 'user' as const, content: 'hi' }],
})

/** Verify that buildParams includes tools when provided */
export function testBuildParamsWithTools(provider: any, model: string) {
  it('buildParams includes tools when provided', () => {
    const params = provider.buildParams({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [minimalTool],
    })
    const toolsField = params.tools ?? params.toolConfig?.tools
    expect(toolsField).toBeDefined()
    expect(toolsField).toHaveLength(1)
  })
}

/** Verify that buildParams merges providerOptions */
export function testBuildParamsMergesOptions(provider: any, model: string, optKey: string, optVal: any, checkKey: string) {
  it('buildParams merges providerOptions', () => {
    const params = provider.buildParams({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      providerOptions: { [optKey]: optVal },
    })
    expect(params[checkKey]).toBe(optVal)
  })
}

/** Verify that malformed JSON in toolCall arguments is handled gracefully */
export function testMalformedJsonArgs(provider: any, findMalformedInput: (mapped: any[]) => any) {
  it('handles malformed JSON in toolCall arguments gracefully', () => {
    const mapped = provider.mapMessages([assistantMalformedArgs]) as any[]
    const input = findMalformedInput(mapped)
    expect(input).toEqual({})
  })
}

/** Verify stream emits done as last chunk */
export function testStreamEmitsDone(chunks: any[]) {
  expect(chunks.at(-1)?.type).toBe('done')
}

/** Verify mapResponseToMessage returns basic text-only assistant message */
export function testMapResponseTextOnly(provider: any, rawResponse: any, expectedText: string) {
  it('maps response with only text (no tool calls)', () => {
    const result = provider.mapResponseToMessage(rawResponse)
    expect(result.role).toBe('assistant')
    expect(result.content).toBe(expectedText)
    expect(result.toolCalls).toBeUndefined()
  })
}

/** Verify assistant with array content and toolCalls maps correctly */
export function testAssistantArrayContentWithToolCalls(provider: any, assertContent: (mapped: any[]) => void) {
  it('maps assistant message with array content and toolCalls', () => {
    const mapped = provider.mapMessages([assistantArrayContent]) as any[]
    assertContent(mapped)
  })
}

/** Verify user message with array content maps correctly */
export function testUserArrayContent(provider: any, assertContent: (mapped: any[]) => void) {
  it('maps user message with array content', () => {
    const mapped = provider.mapMessages([userArrayContent]) as any[]
    assertContent(mapped)
  })
}
