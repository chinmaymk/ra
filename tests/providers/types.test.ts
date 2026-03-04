import { describe, it, expect, expectTypeOf } from 'bun:test'
import type { IProvider, ChatRequest, IMessage, ITool, StreamChunk, ContentPart, TokenUsage } from '../../src/providers/types'

describe('provider types', () => {
  it('ChatRequest accepts messages and optional tools', () => {
    const req: ChatRequest = {
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hello' }],
    }
    expect(req.model).toBe('claude-sonnet-4-6')
  })

  it('IMessage supports multimodal content', () => {
    const msg: IMessage = {
      role: 'user',
      content: [
        { type: 'text', text: 'describe this' },
        { type: 'image', source: { type: 'url', url: 'https://example.com/img.png' } },
      ],
    }
    expect(Array.isArray(msg.content)).toBe(true)
  })

  it('StreamChunk covers all chunk types', () => {
    const chunks: StreamChunk[] = [
      { type: 'text', delta: 'hello' },
      { type: 'tool_call_start', id: '1', name: 'test' },
      { type: 'tool_call_delta', id: '1', argsDelta: '{"x":1}' },
      { type: 'tool_call_end', id: '1' },
      { type: 'done' },
    ]
    expect(chunks).toHaveLength(5)
  })
})

describe('types', () => {
  it('ChatRequest has thinking field', () => {
    const req: ChatRequest = {
      model: 'x',
      messages: [],
      thinking: 'medium',
    }
    expectTypeOf(req.thinking).toEqualTypeOf<'low' | 'medium' | 'high' | undefined>()
  })

  it('StreamChunk accepts thinking variant', () => {
    const chunk: StreamChunk = { type: 'thinking', delta: 'hmm...' }
    expectTypeOf(chunk).toMatchTypeOf<StreamChunk>()
  })

  it('TokenUsage has thinkingTokens', () => {
    const u: TokenUsage = { inputTokens: 10, outputTokens: 5, thinkingTokens: 200 }
    expectTypeOf(u.thinkingTokens).toEqualTypeOf<number | undefined>()
  })
})
