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
