import { describe, it, expect } from 'bun:test'
import { splitMessageZones, createCompactionMiddleware } from '../../src/agent/context-compaction'
import type { IMessage, IProvider, ChatRequest, ChatResponse } from '../../src/providers/types'
import type { ModelCallContext } from '../../src/agent/types'

/** Mock provider — chat returns summary or throws, stream always yields done */
function mockProv(chat: IProvider['chat'] = async () => { throw new Error('should not be called') }): IProvider {
  return {
    name: 'mock',
    chat,
    async *stream() { yield { type: 'done' as const } },
  }
}

/** Mock provider that returns a summary from chat() */
function summaryProv(summary = 'Summary of conversation.'): IProvider {
  return mockProv(async () => ({ message: { role: 'assistant' as const, content: summary } }))
}

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

  it('moves boundary back to include assistant when boundary lands on tool result', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3, user3, asst4]
    const { recent } = splitMessageZones(messages, 16)
    expect(recent).toContain(asst2)
    expect(recent).toContain(tool1)
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

  it('adjusts boundary when it lands on a tool message', () => {
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3]
    const { recent, compactable } = splitMessageZones(messages, 1)
    if (recent.includes(tool1)) {
      expect(recent).toContain(asst2)
    }
    if (compactable.includes(asst2)) {
      expect(compactable).toContain(tool1)
    }
  })

  it('adjusts boundary when it lands right after assistant with toolCalls', () => {
    const messages = [sys, user1, asst2, tool1, asst3]
    const { recent } = splitMessageZones(messages, 1)
    if (recent.includes(tool1)) {
      expect(recent).toContain(asst2)
    }
  })

  it('handles single user message after pinned', () => {
    const messages = [sys, user1]
    const { pinned, compactable, recent } = splitMessageZones(messages, 20_000)
    expect(pinned).toEqual([sys, user1])
    expect(compactable).toEqual([])
    expect(recent).toEqual([])
  })

  it('pins first user message even without system prefix', () => {
    const messages = [user1, asst1, user2]
    const { pinned } = splitMessageZones(messages, 20_000)
    expect(pinned).toEqual([user1])
  })

  it('handles messages with only system and user', () => {
    const messages = [sys, user1, asst1]
    const { pinned, compactable, recent } = splitMessageZones(messages, 20_000)
    expect([...pinned, ...compactable, ...recent]).toEqual(messages)
  })

  it('keeps multiple tool call groups together', () => {
    const asst5: IMessage = { role: 'assistant', content: 'Another tool', toolCalls: [{ id: 'tc2', name: 'write', arguments: '{}' }] }
    const tool2: IMessage = { role: 'tool', content: 'written', toolCallId: 'tc2' }
    const messages = [sys, user1, asst2, tool1, asst5, tool2, asst3]
    const { recent, compactable } = splitMessageZones(messages, 20_000)
    for (const zone of [recent, compactable]) {
      if (zone.includes(asst2)) expect(zone).toContain(tool1)
      if (zone.includes(asst5)) expect(zone).toContain(tool2)
    }
  })

  it('keeps all tool results with their assistant when boundary splits tool group', () => {
    const asstMulti: IMessage = {
      role: 'assistant', content: 'multi',
      toolCalls: [
        { id: 'tc1', name: 'read', arguments: '{}' },
        { id: 'tc2', name: 'write', arguments: '{}' },
      ],
    }
    const toolA: IMessage = { role: 'tool', content: 'result a', toolCallId: 'tc1' }
    const toolB: IMessage = { role: 'tool', content: 'result b', toolCallId: 'tc2' }
    const messages = [sys, user1, asst1, user2, asstMulti, toolA, toolB, asst3, user3, asst4]

    const { recent, compactable } = splitMessageZones(messages, 1)
    if (recent.includes(asstMulti)) {
      expect(recent).toContain(toolA)
      expect(recent).toContain(toolB)
    }
    if (compactable.includes(asstMulti)) {
      expect(compactable).toContain(toolA)
      expect(compactable).toContain(toolB)
    }
    if (recent.includes(toolA) || recent.includes(toolB)) {
      expect(recent).toContain(asstMulti)
    }
  })

  it('does not move boundary when tool result has no preceding assistant with toolCalls', () => {
    const orphanTool: IMessage = { role: 'tool', content: 'orphan result', toolCallId: 'tc_orphan' }
    const asstNoToolCalls: IMessage = { role: 'assistant', content: 'no tools here' }
    const messages = [sys, user1, asstNoToolCalls, orphanTool, user3, asst4]

    const { pinned, compactable, recent } = splitMessageZones(messages, 11)
    expect([...pinned, ...compactable, ...recent]).toEqual(messages)
    expect(recent).toContain(orphanTool)
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
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
    },
  }
}

const longText = 'word '.repeat(200)
const COMPACT_OPTS = { enabled: true, threshold: 0.8, maxTokens: 10, contextWindow: 100 } as const

function longConvo(lastMsg = 'Latest message'): IMessage[] {
  return [
    { role: 'system', content: 'System prompt here' },
    { role: 'user', content: 'First user message here' },
    { role: 'assistant', content: longText },
    { role: 'user', content: longText },
    { role: 'assistant', content: longText },
    { role: 'user', content: lastMsg },
  ]
}

describe('createCompactionMiddleware', () => {
  it('passes through when under threshold', async () => {
    const mw = createCompactionMiddleware(mockProv(), { enabled: true, threshold: 0.8 })
    const messages: IMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })

  it('compacts when over threshold using maxTokens', async () => {
    const mw = createCompactionMiddleware(summaryProv(), COMPACT_OPTS)
    const ctx = makeCtx(longConvo())
    await mw(ctx)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
    expect(ctx.request.messages.length).toBeLessThan(6)
  })

  it('skips compaction when disabled', async () => {
    const mw = createCompactionMiddleware(mockProv(), { enabled: false, threshold: 0.8, maxTokens: 1 })
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'A very long message'.repeat(100) },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })

  it('merges compaction summary into user message to preserve role alternation', async () => {
    const mw = createCompactionMiddleware(summaryProv('Conversation summary.'), COMPACT_OPTS)
    const ctx = makeCtx(longConvo())
    await mw(ctx)
    const summaryMsg = ctx.request.messages.find(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.role).toBe('user')
    for (let i = 1; i < ctx.request.messages.length; i++) {
      if (ctx.request.messages[i]!.role === 'user') {
        expect(ctx.request.messages[i - 1]!.role).not.toBe('user')
      }
    }
  })

  it('handles summarization API failure gracefully', async () => {
    const mw = createCompactionMiddleware(
      mockProv(async () => { throw new Error('API rate limit') }),
      COMPACT_OPTS,
    )
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    const originalLength = ctx.request.messages.length
    await mw(ctx) // Should not throw
    expect(ctx.request.messages.length).toBe(originalLength)
  })

  it('properly extracts text from ContentPart[] pinned user message during compaction', async () => {
    const mw = createCompactionMiddleware(summaryProv('Summary.'), COMPACT_OPTS)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text' as const, text: 'look at this image' }] },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    const summaryMsg = ctx.request.messages.find(
      m => m.role === 'user' && Array.isArray(m.content)
    )
    expect(summaryMsg).toBeDefined()
    const parts = summaryMsg!.content as any[]
    expect(parts.some((p: any) => p.type === 'text' && p.text === 'look at this image')).toBe(true)
    const allText = parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ')
    expect(allText).toContain('[Context Summary]')
  })

  it('preserves ContentPart[] structure when merging summary into pinned user message', async () => {
    const mw = createCompactionMiddleware(summaryProv('Summary.'), COMPACT_OPTS)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: [
        { type: 'text' as const, text: 'look at this image' },
        { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc123' } },
      ] },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    const pinnedUser = ctx.request.messages.find(
      m => m.role === 'user' && Array.isArray(m.content)
    )
    expect(pinnedUser).toBeDefined()
    const parts = pinnedUser!.content as any[]
    expect(parts.some((p: any) => p.type === 'image')).toBe(true)
    const textParts = parts.filter((p: any) => p.type === 'text')
    const allText = textParts.map((p: any) => p.text).join(' ')
    expect(allText).toContain('[Context Summary]')
  })

  it('uses compaction.model for summarization instead of request model', async () => {
    let chatModel = ''
    const mw = createCompactionMiddleware(
      mockProv(async (req) => { chatModel = req.model; return { message: { role: 'assistant' as const, content: 'Summary.' } } }),
      { ...COMPACT_OPTS, model: 'claude-haiku-4-5-20251001' },
    )
    const ctx = makeCtx(longConvo(), 'claude-opus-4-6')
    await mw(ctx)
    expect(chatModel).toBe('claude-haiku-4-5-20251001')
  })

  it('uses real inputTokens from loop.lastUsage when available for threshold check', async () => {
    let chatCalled = false
    const mw = createCompactionMiddleware(
      mockProv(async () => { chatCalled = true; return { message: { role: 'assistant' as const, content: 'Summary.' } } }),
      { enabled: true, threshold: 0.8, maxTokens: 500, contextWindow: 1000 },
    )
    const messages = longConvo()
    const ctx = makeCtx(messages)
    ctx.loop.lastUsage = { inputTokens: 100, outputTokens: 50 }
    await mw(ctx)
    expect(chatCalled).toBe(false)
  })

  it('calls onCompact callback with compaction details', async () => {
    let compactInfo: Record<string, unknown> | undefined
    const mw = createCompactionMiddleware(summaryProv(), {
      ...COMPACT_OPTS,
      onCompact: (info) => { compactInfo = info },
    })
    const ctx = makeCtx(longConvo())
    await mw(ctx)
    expect(compactInfo).toBeDefined()
    expect(compactInfo!.originalMessages).toBe(6)
    expect(compactInfo!.compactedMessages).toBeLessThan(6)
    expect(compactInfo!.estimatedTokens).toBeGreaterThan(10)
    expect(compactInfo!.threshold).toBe(10)
  })

  it('does not call onCompact when compaction is skipped', async () => {
    let called = false
    const mw = createCompactionMiddleware(mockProv(), {
      enabled: true, threshold: 0.8,
      onCompact: () => { called = true },
    })
    const messages: IMessage[] = [
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(called).toBe(false)
  })

  it('does not call onCompact when summarization fails', async () => {
    let called = false
    const mw = createCompactionMiddleware(
      mockProv(async () => { throw new Error('API rate limit') }),
      { ...COMPACT_OPTS, onCompact: () => { called = true } },
    )
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(called).toBe(false)
  })

  it('skips when nothing to compact (all pinned)', async () => {
    const mw = createCompactionMiddleware(mockProv(), { enabled: true, threshold: 0.8, maxTokens: 1 })
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(ctx.request.messages).toEqual(messages)
  })
})
