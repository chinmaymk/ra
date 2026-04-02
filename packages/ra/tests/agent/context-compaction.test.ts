import { describe, it, expect } from 'bun:test'
import { splitMessageZones, createCompactionMiddleware, isContextLengthError, forceCompact, parseContextWindowFromError, extractCompactionMetadata, formatCompactionSummary } from '@chinmaymk/ra'
import type { IMessage, IProvider, ChatResponse, CompactionMetadata } from '@chinmaymk/ra'
import { makeModelCallCtx } from './test-utils'

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
    // rest = [asst1(3t), user2(3t), asst2+tc(13t), tool1(4t), asst3(5t), user3(2t), asst4(4t)]
    // budget=16: walk back accumulates asst4(4)+user3(6)+asst3(11)+tool1(15)=15 ≤16
    //   then asst2: 15+13=28>16 → boundary=3 (tool1 in rest)
    // adjustToolCallBoundary finds tool at [3], searches back, finds asst2 at [2] with toolCalls → return 2
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3, user3, asst4]
    const { recent } = splitMessageZones(messages, 16)
    // asst2 and tool1 should both be in recent
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
    // Use a very small budget so the boundary lands right on tool1
    // The tool message should pull back to include its assistant
    const messages = [sys, user1, asst1, user2, asst2, tool1, asst3]
    const { recent, compactable } = splitMessageZones(messages, 1)
    // If tool1 is in recent, asst2 must also be in recent
    if (recent.includes(tool1)) {
      expect(recent).toContain(asst2)
    }
    // If asst2 is in compactable, tool1 must also be in compactable
    if (compactable.includes(asst2)) {
      expect(compactable).toContain(tool1)
    }
  })

  it('adjusts boundary when it lands right after assistant with toolCalls', () => {
    // Create scenario where boundary-1 is an assistant with toolCalls
    const messages = [sys, user1, asst2, tool1, asst3]
    const { recent } = splitMessageZones(messages, 1)
    // asst2 and tool1 should stay together
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
    // Each tool call group should be intact
    for (const zone of [recent, compactable]) {
      if (zone.includes(asst2)) expect(zone).toContain(tool1)
      if (zone.includes(asst5)) expect(zone).toContain(tool2)
    }
  })

  it('keeps all tool results with their assistant when boundary splits tool group', () => {
    // Bug: assistant with tc1+tc2 could have tool_tc1 left in compactable
    // when boundary pulls assistant into recent
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

    // Use a budget that places boundary somewhere inside the tool group
    const { recent, compactable } = splitMessageZones(messages, 1)
    // asstMulti, toolA, and toolB must all be in the same zone
    if (recent.includes(asstMulti)) {
      expect(recent).toContain(toolA)
      expect(recent).toContain(toolB)
    }
    if (compactable.includes(asstMulti)) {
      expect(compactable).toContain(toolA)
      expect(compactable).toContain(toolB)
    }
    // And vice versa - if any tool result is in recent, the assistant must be too
    if (recent.includes(toolA) || recent.includes(toolB)) {
      expect(recent).toContain(asstMulti)
    }
  })

  it('does not move boundary when tool result has no preceding assistant with toolCalls', () => {
    // We need adjustToolCallBoundary to receive boundary landing on a tool message,
    // with no assistant+toolCalls before it. The for loop (lines 51-54) completes without returning.
    //
    // rest array after pinning [sys, user1]:
    //   [0]=asstNoToolCalls(4 tokens), [1]=orphanTool(4), [2]=user3(2), [3]=asst4(4)
    //
    // Token walk backward with budget=11:
    //   i=3: 0+4=4 ≤11 → include, recentStart=3, tokens=4
    //   i=2: 4+2=6 ≤11 → include, recentStart=2, tokens=6
    //   i=1: 6+4=10 ≤11 → include, recentStart=1, tokens=10
    //   i=0: 10+4=14 >11, recentStart(1)<4 → break → boundary=1 (the tool msg)
    //
    // adjustToolCallBoundary sees rest[1].role='tool', then searches backward:
    //   i=0: rest[0] is assistant but has NO toolCalls → loop finishes without match
    // Falls through to the second check and returns boundary=1 unchanged.
    const orphanTool: IMessage = { role: 'tool', content: 'orphan result', toolCallId: 'tc_orphan' }
    const asstNoToolCalls: IMessage = { role: 'assistant', content: 'no tools here' }
    const messages = [sys, user1, asstNoToolCalls, orphanTool, user3, asst4]

    const { pinned, compactable, recent } = splitMessageZones(messages, 11)
    expect([...pinned, ...compactable, ...recent]).toEqual(messages)
    // orphanTool should be in recent (boundary=1 in rest, which is index 3 in original)
    expect(recent).toContain(orphanTool)
  })
})

const makeCtx = (messages: IMessage[], model = 'claude-sonnet-4-6') =>
  makeModelCallCtx(messages, { request: { model, messages: [...messages], tools: [] } })

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
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100 })
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
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
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

  it('merges compaction summary into user message to preserve role alternation', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => ({
        message: { role: 'assistant' as const, content: 'Conversation summary.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100 })
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'Latest message' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    // Summary should be merged into a user message
    const summaryMsg = ctx.request.messages.find(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(summaryMsg).toBeDefined()
    expect(summaryMsg!.role).toBe('user')
    // No consecutive user messages should exist
    for (let i = 1; i < ctx.request.messages.length; i++) {
      if (ctx.request.messages[i]!.role === 'user') {
        expect(ctx.request.messages[i - 1]!.role).not.toBe('user')
      }
    }
  })

  it('handles summarization API failure gracefully', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('API rate limit') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100 })
    const longText = 'word '.repeat(200)
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
    const provider: IProvider = {
      name: 'mock',
      chat: async () => ({
        message: { role: 'assistant' as const, content: 'Summary.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100 })
    const longText = 'word '.repeat(200)
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
    // With the fix, ContentPart[] is preserved, not flattened to string
    const summaryMsg = ctx.request.messages.find(
      m => m.role === 'user' && Array.isArray(m.content)
    )
    expect(summaryMsg).toBeDefined()
    const parts = summaryMsg!.content as any[]
    // Original text part preserved
    expect(parts.some((p: any) => p.type === 'text' && p.text === 'look at this image')).toBe(true)
    // Summary appended as text part
    const allText = parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ')
    expect(allText).toContain('[Context Summary]')
  })

  it('preserves ContentPart[] structure when merging summary into pinned user message', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => ({
        message: { role: 'assistant' as const, content: 'Summary.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100 })
    const longText = 'word '.repeat(200)
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
    // ContentPart[] should be preserved (not flattened to string)
    expect(pinnedUser).toBeDefined()
    const parts = pinnedUser!.content as any[]
    // Should still have the image_url part
    expect(parts.some((p: any) => p.type === 'image')).toBe(true)
    // Should also have the summary text appended
    const textParts = parts.filter((p: any) => p.type === 'text')
    const allText = textParts.map((p: any) => p.text).join(' ')
    expect(allText).toContain('[Context Summary]')
  })

  it('uses compaction.model for summarization instead of request model', async () => {
    let chatModel = ''
    const provider: IProvider = {
      name: 'mock',
      chat: async (req) => {
        chatModel = req.model
        return { message: { role: 'assistant' as const, content: 'Summary.' } }
      },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100,
      model: 'claude-haiku-4-5-20251001',
    })
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages, 'claude-opus-4-6')
    await mw(ctx)
    expect(chatModel).toBe('claude-haiku-4-5-20251001')
  })

  it('uses real inputTokens from loop.lastUsage when available for threshold check', async () => {
    let chatCalled = false
    const provider: IProvider = {
      name: 'mock',
      chat: async () => {
        chatCalled = true
        return { message: { role: 'assistant' as const, content: 'Summary.' } }
      },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.8, maxTokens: 500, contextWindow: 1000,
    })
    const longText = 'word '.repeat(600)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    ctx.loop.lastUsage = { inputTokens: 100, outputTokens: 50 }
    await mw(ctx)
    expect(chatCalled).toBe(false)
  })

  it('calls onCompact callback with compaction details', async () => {
    let compactInfo: Record<string, unknown> | undefined
    const provider: IProvider = {
      name: 'mock',
      chat: async () => ({
        message: { role: 'assistant' as const, content: 'Summary of conversation.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100,
      onCompact: (info) => { compactInfo = info },
    })
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
    expect(compactInfo).toBeDefined()
    expect(compactInfo!.originalMessages).toBe(6)
    expect(compactInfo!.compactedMessages).toBeLessThan(6)
    expect(compactInfo!.estimatedTokens).toBeGreaterThan(10)
    expect(compactInfo!.threshold).toBe(10)
  })

  it('does not call onCompact when compaction is skipped', async () => {
    let called = false
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, {
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
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('API rate limit') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100,
      onCompact: () => { called = true },
    })
    const longText = 'word '.repeat(200)
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

  it('forceCompact compacts regardless of threshold', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async (): Promise<ChatResponse> => ({
        message: { role: 'assistant' as const, content: 'Forced summary.' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    // Very high threshold that would never trigger normally, but small contextWindow so messages are compactable
    const result = await forceCompact(provider, { enabled: true, threshold: 0.99, strategy: 'summarize', contextWindow: 100 }, ctx)
    expect(result).toBe(true)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(hasSummary).toBe(true)
  })

  it('uses custom prompt when provided in config', async () => {
    let receivedPrompt = ''
    const provider: IProvider = {
      name: 'mock',
      chat: async (req) => {
        const content = req.messages[0]?.content
        receivedPrompt = typeof content === 'string' ? content : ''
        return { message: { role: 'assistant' as const, content: 'Summary.' } }
      },
      async *stream() { yield { type: 'done' as const } },
    }
    const customPrompt = 'You are a custom summarizer. Summarize everything in bullet points.'
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100,
      prompt: customPrompt,
    })
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(receivedPrompt).toContain(customPrompt)
    expect(receivedPrompt).not.toContain('<instructions>')
  })

  it('uses default prompt when no custom prompt is provided', async () => {
    let receivedPrompt = ''
    const provider: IProvider = {
      name: 'mock',
      chat: async (req) => {
        const content = req.messages[0]?.content
        receivedPrompt = typeof content === 'string' ? content : ''
        return { message: { role: 'assistant' as const, content: 'Summary.' } }
      },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100,
    })
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(receivedPrompt).toContain('<instructions>')
    expect(receivedPrompt).toContain('<conversation>')
  })

  it('truncate strategy drops old messages without API call', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
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
    // Should have fewer messages (compactable zone dropped)
    expect(ctx.request.messages.length).toBeLessThan(messages.length)
    // No summary injected (no API call made)
    const hasSummary = ctx.request.messages.some(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(hasSummary).toBe(false)
    // Pinned zone preserved exactly
    expect(ctx.request.messages[0]).toEqual({ role: 'system', content: 'System prompt here' })
    expect(ctx.request.messages[1]).toEqual({ role: 'user', content: 'First user message here' })
  })

  it('truncate strategy preserves pinned zone immutably', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, maxTokens: 10, contextWindow: 100 })
    const longText = 'word '.repeat(200)
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
    // Pinned user message should be unchanged (not mutated with summary)
    const pinnedUser = ctx.request.messages.find(m => m.role === 'user' && Array.isArray(m.content))
    expect(pinnedUser).toBeDefined()
    expect(pinnedUser!.content).toEqual([{ type: 'text', text: 'look at this image' }])
  })

  it('truncate strategy calls onCompact callback', async () => {
    let compactInfo: Record<string, unknown> | undefined
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.8, maxTokens: 10, contextWindow: 100,
      onCompact: (info) => { compactInfo = info },
    })
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    expect(compactInfo).toBeDefined()
    expect(compactInfo!.originalMessages).toBe(6)
    expect(compactInfo!.compactedMessages).toBeLessThan(6)
  })

  it('truncate drops from back of compactable zone to preserve prefix for caching', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const shortText = 'word '.repeat(10)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
    ]
    for (let i = 0; i < 20; i++) {
      messages.push({ role: 'assistant', content: `assistant turn ${i} ${shortText}` })
      messages.push({ role: 'user', content: `user turn ${i} ${shortText}` })
    }
    const ctx = makeCtx(messages)
    ctx.loop.lastUsage = { inputTokens: 950, outputTokens: 50 }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.9, contextWindow: 1000,
    })
    await mw(ctx)
    // Should keep some compactable messages but not all
    expect(ctx.request.messages.length).toBeGreaterThan(4)
    expect(ctx.request.messages.length).toBeLessThan(42)
    // Pinned zone preserved exactly
    expect(ctx.request.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(ctx.request.messages[1]).toEqual({ role: 'user', content: 'first' })
    // Prefix preservation: the OLDEST compactable messages (turn 0, 1, ...) should
    // be right after pinned, NOT the newest. This proves we drop from the back.
    const thirdMsg = ctx.request.messages[2]!
    expect(thirdMsg.content).toContain('assistant turn 0')
  })

  it('truncate strategy does not orphan tool results at drop boundary', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      // Tool call group that might get split
      { role: 'assistant', content: 'calling tools', toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }] },
      { role: 'tool', content: 'file contents here '.repeat(50), toolCallId: 'tc1' },
      { role: 'assistant', content: 'result' },
      { role: 'user', content: 'thanks' },
      { role: 'assistant', content: 'welcome' },
    ]
    const ctx = makeCtx(messages)
    ctx.loop.lastUsage = { inputTokens: 900, outputTokens: 50 }
    const mw = createCompactionMiddleware(provider, {
      enabled: true, threshold: 0.9, contextWindow: 1000,
    })
    await mw(ctx)
    // No orphaned tool results: every tool message must have its assistant before it
    for (let i = 0; i < ctx.request.messages.length; i++) {
      const m = ctx.request.messages[i]!
      if (m.role === 'tool') {
        // Find the assistant with matching toolCalls before this tool result
        let found = false
        for (let j = i - 1; j >= 0; j--) {
          const prev = ctx.request.messages[j]!
          if (prev.role === 'assistant' && prev.toolCalls) { found = true; break }
          if (prev.role !== 'tool') break
        }
        expect(found).toBe(true)
      }
    }
  })

  it('forceCompact with truncate strategy drops without API call', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('should not be called') },
      async *stream() { yield { type: 'done' as const } },
    }
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: longText },
      { role: 'user', content: longText },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    const result = await forceCompact(provider, { enabled: true, threshold: 0.99, contextWindow: 100 }, ctx)
    expect(result).toBe(true)
    expect(ctx.request.messages.length).toBeLessThan(messages.length)
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

describe('isContextLengthError', () => {
  it('matches real provider SDK error messages', () => {
    // Anthropic SDK
    expect(isContextLengthError(new Error('400 request too large'))).toBe(true)
    expect(isContextLengthError(new Error('400 prompt is too long: 250000 tokens > 200000 maximum'))).toBe(true)
    expect(isContextLengthError(new Error('400 input length and max_tokens exceed context limit: 188240 + 21333 > 200000'))).toBe(true)
    expect(isContextLengthError(new Error('413 Request size exceeds model context window'))).toBe(true)
    // OpenAI / Azure SDK
    expect(isContextLengthError(new Error("400 This model's maximum context length is 128000 tokens."))).toBe(true)
    // Ollama
    expect(isContextLengthError(new Error('prompt too long; exceeded max context length by 4 tokens'))).toBe(true)
    // Google Gemini
    expect(isContextLengthError(new Error('[400 Bad Request] Request exceeds the maximum number of tokens'))).toBe(true)
    // Bedrock
    expect(isContextLengthError(new Error('ValidationException: Too many tokens'))).toBe(true)
    expect(isContextLengthError(new Error('ValidationException: Input is too long for requested model.'))).toBe(true)
    // Ollama sequence length
    expect(isContextLengthError(new Error('Token sequence length exceeds limit (5000 > 4096)'))).toBe(true)
    // Mistral
    expect(isContextLengthError(new Error("The number of tokens in the prompt exceeds the model's maximum context length of 32768."))).toBe(true)
    // Cohere
    expect(isContextLengthError(new Error('Too many tokens: the total number of tokens in the prompt exceeds the limit of 4081 tokens.'))).toBe(true)
    // DeepSeek (OpenAI-compatible)
    expect(isContextLengthError(new Error("This model's maximum context length is 65536 tokens."))).toBe(true)
    // Perplexity
    expect(isContextLengthError(new Error('[400] Messages have 16865 tokens, which exceeds the max limit of 8192 tokens.'))).toBe(true)
    // Generic patterns
    expect(isContextLengthError(new Error('context length exceeded'))).toBe(true)
    expect(isContextLengthError(new Error('token limit exceeded'))).toBe(true)
    expect(isContextLengthError(new Error('token_limit_exceeded'))).toBe(true)
    expect(isContextLengthError(new Error('input too long'))).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isContextLengthError(new Error('API rate limit'))).toBe(false)
    expect(isContextLengthError(new Error('Exceeded token rate limit of your current OpenAI model'))).toBe(false)
    expect(isContextLengthError(new Error('Prediction aborted due to token repeat limit reached'))).toBe(false)
    expect(isContextLengthError(new Error('network timeout'))).toBe(false)
    expect(isContextLengthError(new Error('authentication failed'))).toBe(false)
  })

  it('handles non-Error values', () => {
    expect(isContextLengthError('context length exceeded')).toBe(true)
    expect(isContextLengthError('random error')).toBe(false)
  })
})

describe('parseContextWindowFromError', () => {
  it('extracts limit from Anthropic "prompt is too long" error', () => {
    expect(parseContextWindowFromError(new Error('400 prompt is too long: 208310 tokens > 200000 maximum'))).toBe(200_000)
  })

  it('extracts limit from Anthropic "exceed context limit" error', () => {
    expect(parseContextWindowFromError(new Error('400 input length and max_tokens exceed context limit: 188240 + 21333 > 200000'))).toBe(200_000)
  })

  it('extracts limit from OpenAI "maximum context length" error', () => {
    expect(parseContextWindowFromError(new Error("400 This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens."))).toBe(128_000)
  })

  it('extracts limit from Ollama "sequence length exceeds limit" error', () => {
    expect(parseContextWindowFromError(new Error('Token sequence length exceeds limit (5000 > 4096)'))).toBe(4_096)
  })

  it('extracts limit from Gemini "maximum number of tokens allowed" error', () => {
    expect(parseContextWindowFromError(new Error('The input token count (1236488) exceeds the maximum number of tokens allowed (1048576).'))).toBe(1_048_576)
  })

  it('extracts limit from Mistral "context length of" error', () => {
    expect(parseContextWindowFromError(new Error('The number of tokens in the prompt exceeds the model\'s maximum context length of 32768. Please use a shorter prompt.'))).toBe(32_768)
  })

  it('extracts limit from Perplexity "max limit of" error', () => {
    expect(parseContextWindowFromError(new Error('[400] Messages have 16865 tokens, which exceeds the max limit of 8192 tokens.'))).toBe(8_192)
  })

  it('extracts limit from Cohere "limit of N tokens" error', () => {
    expect(parseContextWindowFromError(new Error('Too many tokens: the total number of tokens in the prompt exceeds the limit of 4081 tokens.'))).toBe(4_081)
  })

  it('extracts limit from Cohere "Max size" error', () => {
    expect(parseContextWindowFromError(new Error('Request body too large for cohere-command-r model. Max size: 8000 tokens.'))).toBe(8_000)
  })

  it('extracts limit from Together AI "must not exceed" error', () => {
    expect(parseContextWindowFromError(new Error("Input validation error: The sum of 'inputs' tokens and 'max_new_tokens' must not exceed 4097."))).toBe(4_097)
  })

  it('extracts limit from DeepSeek "maximum allowed length" error', () => {
    expect(parseContextWindowFromError(new Error('Input length (160062 tokens) exceeds the maximum allowed length (59862 tokens).'))).toBe(59_862)
  })

  it('extracts limit from Azure OpenAI error (same as OpenAI)', () => {
    expect(parseContextWindowFromError(new Error("This model's maximum context length is 4097 tokens. However, you requested 4927 tokens (3927 in the messages, 1000 in the completion)."))).toBe(4_097)
  })

  it('returns undefined for errors without parseable limit', () => {
    expect(parseContextWindowFromError(new Error('request too large'))).toBeUndefined()
    expect(parseContextWindowFromError(new Error('too many tokens'))).toBeUndefined()
    expect(parseContextWindowFromError(new Error('network timeout'))).toBeUndefined()
  })

  it('handles non-Error values', () => {
    expect(parseContextWindowFromError('maximum context length is 32000 tokens')).toBe(32_000)
    expect(parseContextWindowFromError('random string')).toBeUndefined()
  })
})

describe('extractCompactionMetadata', () => {
  it('extracts tool names from toolCalls', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: 'calling tools', toolCalls: [
        { id: 'tc1', name: 'read_file', arguments: '{}' },
        { id: 'tc2', name: 'write_file', arguments: '{}' },
      ] },
      { role: 'tool', content: 'result', toolCallId: 'tc1' },
      { role: 'tool', content: 'result', toolCallId: 'tc2' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.toolNames).toContain('read_file')
    expect(meta.toolNames).toContain('write_file')
  })

  it('deduplicates tool names', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: 'a', toolCalls: [{ id: 'tc1', name: 'read', arguments: '{}' }] },
      { role: 'tool', content: 'r', toolCallId: 'tc1' },
      { role: 'assistant', content: 'b', toolCalls: [{ id: 'tc2', name: 'read', arguments: '{}' }] },
      { role: 'tool', content: 'r', toolCallId: 'tc2' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.toolNames).toEqual(['read'])
  })

  it('extracts file paths from string content', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'Please edit src/index.ts and lib/utils.py' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.filePaths).toContain('src/index.ts')
    expect(meta.filePaths).toContain('lib/utils.py')
  })

  it('extracts file paths from ContentPart[] content', () => {
    const messages: IMessage[] = [
      { role: 'user', content: [
        { type: 'text', text: 'I modified packages/core/main.rs today' },
      ] },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.filePaths).toContain('packages/core/main.rs')
  })

  it('detects pending work keywords', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: 'I completed the first part. TODO: handle edge cases.' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.hasPendingWork).toBe(true)
  })

  it('detects "next step" as pending work', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: 'The next step is to add validation.' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.hasPendingWork).toBe(true)
  })

  it('detects "remaining" as pending work', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'There are remaining issues to fix.' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.hasPendingWork).toBe(true)
  })

  it('reports no pending work when none detected', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: 'Everything is done and working.' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.hasPendingWork).toBe(false)
  })

  it('limits tool names to MAX_METADATA_ITEMS', () => {
    const toolCalls = Array.from({ length: 60 }, (_, i) => ({
      id: `tc${i}`, name: `tool_${i}`, arguments: '{}',
    }))
    const messages: IMessage[] = [
      { role: 'assistant', content: 'many tools', toolCalls },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.toolNames.length).toBeLessThanOrEqual(50)
  })

  it('limits file paths to MAX_METADATA_ITEMS', () => {
    const paths = Array.from({ length: 60 }, (_, i) => `file${i}.ts`).join(' ')
    const messages: IMessage[] = [
      { role: 'user', content: paths },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.filePaths.length).toBeLessThanOrEqual(50)
  })

  it('returns empty arrays for messages with no tools or files', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'Hello, how are you?' },
      { role: 'assistant', content: 'I am fine, thanks!' },
    ]
    const meta = extractCompactionMetadata(messages)
    expect(meta.toolNames).toEqual([])
    expect(meta.filePaths).toEqual([])
    expect(meta.hasPendingWork).toBe(false)
  })
})

describe('formatCompactionSummary', () => {
  const baseMeta: CompactionMetadata = { toolNames: [], filePaths: [], hasPendingWork: false }

  it('includes tool names in output', () => {
    const meta: CompactionMetadata = { ...baseMeta, toolNames: ['read_file', 'write_file'] }
    const result = formatCompactionSummary('The user edited files.', meta)
    expect(result).toContain('Tools used: read_file, write_file')
  })

  it('includes file paths in output', () => {
    const meta: CompactionMetadata = { ...baseMeta, filePaths: ['src/main.ts', 'lib/utils.py'] }
    const result = formatCompactionSummary('Worked on two files.', meta)
    expect(result).toContain('Key files: src/main.ts, lib/utils.py')
  })

  it('includes pending work from metadata', () => {
    const meta: CompactionMetadata = { ...baseMeta, hasPendingWork: true }
    const result = formatCompactionSummary('Started the refactor.', meta)
    expect(result).toContain('Pending work:')
  })

  it('preserves previous summary as separate section', () => {
    const result = formatCompactionSummary('New summary here.', baseMeta, 'Old summary from before.')
    expect(result).toContain('Previously compacted context:')
    expect(result).toContain('Old summary from before.')
  })

  it('parses <summary> XML tag from LLM response', () => {
    const llm = '<summary>The user asked to fix a bug in the login flow.</summary>'
    const result = formatCompactionSummary(llm, baseMeta)
    expect(result).toContain('The user asked to fix a bug in the login flow.')
    expect(result).not.toContain('<summary>')
  })

  it('parses <pending_work> XML tag from LLM response', () => {
    const llm = '<summary>Fixed auth.</summary>\n<pending_work>Still need to add tests.</pending_work>'
    const result = formatCompactionSummary(llm, baseMeta)
    expect(result).toContain('Pending work: Still need to add tests.')
  })

  it('parses <key_files> XML tag and deduplicates with metadata', () => {
    const llm = '<summary>Edited files.</summary>\n<key_files>\n- src/main.ts\n- src/other.ts\n</key_files>'
    const meta: CompactionMetadata = { ...baseMeta, filePaths: ['src/main.ts', 'lib/new.rs'] }
    const result = formatCompactionSummary(llm, meta)
    expect(result).toContain('src/main.ts')
    expect(result).toContain('src/other.ts')
    expect(result).toContain('lib/new.rs')
    // src/main.ts should appear only once
    const keyFilesLine = result.split('\n').find(l => l.startsWith('Key files:'))!
    const occurrences = keyFilesLine.split('src/main.ts').length - 1
    expect(occurrences).toBe(1)
  })

  it('handles LLM response with no XML tags', () => {
    const result = formatCompactionSummary('Just a plain summary.', baseMeta)
    expect(result).toContain('Just a plain summary.')
  })

  it('omits sections when metadata is empty', () => {
    const result = formatCompactionSummary('Simple summary.', baseMeta)
    expect(result).not.toContain('Tools used:')
    expect(result).not.toContain('Key files:')
    expect(result).not.toContain('Pending work:')
  })
})

describe('summarize strategy with metadata integration', () => {
  it('includes metadata in compacted summary', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => ({
        message: { role: 'assistant' as const, content: '<summary>User worked on auth module.</summary>\n<pending_work>Add error handling.</pending_work>' },
      }),
      async *stream() { yield { type: 'done' as const } },
    }
    const mw = createCompactionMiddleware(provider, { enabled: true, threshold: 0.8, strategy: 'summarize', maxTokens: 10, contextWindow: 100 })
    const longText = 'word '.repeat(200)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'fix src/auth.ts' },
      { role: 'assistant', content: 'calling read', toolCalls: [{ id: 'tc1', name: 'read_file', arguments: '{}' }] },
      { role: 'tool', content: longText, toolCallId: 'tc1' },
      { role: 'assistant', content: longText },
      { role: 'user', content: 'latest' },
    ]
    const ctx = makeCtx(messages)
    await mw(ctx)
    const summaryMsg = ctx.request.messages.find(
      m => typeof m.content === 'string' && m.content.includes('[Context Summary]')
    )
    expect(summaryMsg).toBeDefined()
    const content = summaryMsg!.content as string
    expect(content).toContain('Tools used: read_file')
    expect(content).toContain('Pending work: Add error handling.')
  })
})
