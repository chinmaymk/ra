import { describe, it, expect } from 'bun:test'
import { splitMessageZones, createCompactionMiddleware } from '../../src/agent/context-compaction'
import type { IMessage, IProvider, ChatRequest } from '../../src/providers/types'
import type { ModelCallContext } from '../../src/agent/types'

describe('splitMessageZones', () => {
  const sys: IMessage = { role: 'system', content: 'You are helpful.' }
  const user1: IMessage = { role: 'user', content: 'Hello' }
  const asst1: IMessage = { role: 'assistant', content: 'Hi there!' }
  const user2: IMessage = { role: 'user', content: 'Do something' }
  const asst2: IMessage = { role: 'assistant', content: 'Sure', toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }] }
  const tool1: IMessage = { role: 'tool', content: 'file contents', toolCallId: 'tc1' }
  const asst3: IMessage = { role: 'assistant', content: 'Here is the result' }
  const user3: IMessage = { role: 'user', content: 'Thanks' }
  const asst4: IMessage = { role: 'assistant', content: 'You are welcome' }

  it('pins system messages and first user message', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3]
    const { pinned } = splitMessageZones(messages, 20_000)
    expect(pinned).toEqual([sys, user1])
  })

  it('keeps recent messages within token budget', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3, user3, asst4]
    const { recent } = splitMessageZones(messages, 20_000)
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.at(-1)).toEqual(asst4)
  })

  it('does not split tool call from tool result', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3]
    const { recent, compactable } = splitMessageZones(messages, 20_000)
    if (recent.includes(asst2)) {
      expect(recent).toContain(tool1)
    }
    if (compactable.includes(tool1)) {
      expect(compactable).toContain(asst2)
    }
  })

  it('returns empty compactable when not enough messages', () => {
    const messages = [sys, user1, asst1]
    const { compactable } = splitMessageZones(messages, 20_000)
    expect(compactable).toEqual([])
  })

  it('all zones together equal original messages', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3, user3, asst4]
    const { pinned, compactable, recent } = splitMessageZones(messages, 20_000)
    expect([...pinned, ...compactable, ...recent]).toEqual(messages)
  })
})

function makeCtx(messages: IMessage[], model = 'claude-sonnet-4-6'): ModelCallContext {
  const controller = new AbortController()
  const request: ChatRequest = { model, messages: [...messages], tools: [] }
  return {
    stop: () => controller.abort(),
    signal: controller.signal,
    request,
    loop: {
      stop: () => controller.abort(),
      signal: controller.signal,
      messages,
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
    },
  }
}

describe('createCompactionMiddleware', () => {
  it('passes through when under threshold', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8 })
    const messages: IMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })

  it('compacts when over threshold using maxTokens', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => ({
        message: { role: 'assistant' as const, content: 'Summary of conversation.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, maxTokens: 10, contextWindow: 100 })
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'System prompt here' },
      { role: 'user', content: 'First user message here' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'Latest message' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.startsWith('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
    expect(ctx.request.messages.length).toBeLessThan(messages.length)
  })

  it('skips compaction when disabled', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: false, threshold: 0.8, maxTokens: 1 })
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'A very long message'.repeat(100) },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })

  it('skips when nothing to compact (all pinned)', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, maxTokens: 1 })
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })
})
