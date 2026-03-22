import { describe, it, expect, beforeEach } from 'bun:test'
import { ScratchpadStore } from '../../src/scratchpad/store'
import { scratchpadWriteTool, scratchpadDeleteTool } from '../../src/scratchpad/tools'
import { createScratchpadMiddleware } from '../../src/scratchpad/middleware'
import type { IMessage, ModelCallContext } from '@chinmaymk/ra'

let store: ScratchpadStore

beforeEach(() => {
  store = new ScratchpadStore()
})

describe('ScratchpadStore', () => {
  it('set and get', () => {
    store.set('plan', 'step 1: do the thing')
    expect(store.get('plan')).toBe('step 1: do the thing')
  })

  it('returns undefined for missing key', () => {
    expect(store.get('nope')).toBeUndefined()
  })

  it('overwrites existing key', () => {
    store.set('plan', 'v1')
    store.set('plan', 'v2')
    expect(store.get('plan')).toBe('v2')
    expect(store.size()).toBe(1)
  })

  it('deletes key', () => {
    store.set('temp', 'value')
    expect(store.delete('temp')).toBe(true)
    expect(store.has('temp')).toBe(false)
    expect(store.size()).toBe(0)
  })

  it('delete returns false for missing key', () => {
    expect(store.delete('nope')).toBe(false)
  })

  it('has checks existence', () => {
    store.set('key', 'val')
    expect(store.has('key')).toBe(true)
    expect(store.has('other')).toBe(false)
  })

  it('entries returns all pairs', () => {
    store.set('a', '1')
    store.set('b', '2')
    expect(store.entries()).toEqual({ a: '1', b: '2' })
  })

  it('keys returns all keys', () => {
    store.set('x', '1')
    store.set('y', '2')
    expect(store.keys()).toEqual(['x', 'y'])
  })

  it('size tracks count', () => {
    expect(store.size()).toBe(0)
    store.set('a', '1')
    store.set('b', '2')
    expect(store.size()).toBe(2)
    store.delete('a')
    expect(store.size()).toBe(1)
  })

  it('clear removes everything', () => {
    store.set('a', '1')
    store.set('b', '2')
    store.clear()
    expect(store.size()).toBe(0)
    expect(store.entries()).toEqual({})
  })
})

describe('scratchpad tools', () => {
  it('write stores value in the store', async () => {
    const write = scratchpadWriteTool(store)
    const result = await write.execute({ key: 'plan', value: 'build the feature' }) as string
    expect(result).toContain('Stored')
    expect(store.get('plan')).toBe('build the feature')
  })

  it('write overwrites existing key', async () => {
    const write = scratchpadWriteTool(store)
    await write.execute({ key: 'plan', value: 'v1' })
    await write.execute({ key: 'plan', value: 'v2' })
    expect(store.get('plan')).toBe('v2')
    expect(store.size()).toBe(1)
  })

  it('delete existing key', async () => {
    store.set('task', 'do stuff')
    const del = scratchpadDeleteTool(store)
    const result = await del.execute({ key: 'task' }) as string
    expect(result).toContain('Removed')
    expect(store.has('task')).toBe(false)
  })

  it('delete missing key', async () => {
    const del = scratchpadDeleteTool(store)
    const result = await del.execute({ key: 'nope' }) as string
    expect(result).toContain('not found')
  })
})

describe('scratchpad middleware', () => {
  function makeCtx(messages: IMessage[]): ModelCallContext {
    return {
      request: {
        model: 'test',
        messages,
        tools: [],
      },
      loop: {
        messages,
        iteration: 1,
        maxIterations: 10,
        sessionId: 'test',
        usage: { inputTokens: 0, outputTokens: 0 },
        lastUsage: undefined,
        resumed: false,
        elapsedMs: 0,
        stop: () => {},

        signal: new AbortController().signal,
        logger: { debug() {}, info() {}, warn() {}, error() {}, flush: async () => {} } as any,
      },
      stop: () => {},
      drain: () => {},
      signal: new AbortController().signal,
      logger: { debug() {}, info() {}, warn() {}, error() {}, flush: async () => {} } as any,
    }
  }

  it('injects scratchpad into messages', async () => {
    store.set('plan', 'step 1: research')
    store.set('decisions', 'use bun')

    const mw = createScratchpadMiddleware(store)
    const messages: IMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]
    await mw(makeCtx(messages))

    expect(messages).toHaveLength(3)
    // Injected after the first user message (the pinned zone)
    const injected = messages[2]!
    expect(injected.role).toBe('user')
    const content = injected.content as string
    expect(content).toContain('<scratchpad>')
    expect(content).toContain('### plan')
    expect(content).toContain('step 1: research')
    expect(content).toContain('### decisions')
    expect(content).toContain('use bun')
    expect(content).toContain('</scratchpad>')
  })

  it('skips injection when store is empty', async () => {
    const mw = createScratchpadMiddleware(store)
    const messages: IMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]
    await mw(makeCtx(messages))
    expect(messages).toHaveLength(2)
  })

  it('removes stale injection and re-injects fresh state', async () => {
    store.set('plan', 'v1')

    const mw = createScratchpadMiddleware(store)
    const messages: IMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]

    // First injection
    await mw(makeCtx(messages))
    expect(messages).toHaveLength(3)
    expect((messages[2]!.content as string)).toContain('v1')

    // Update store and re-inject
    store.set('plan', 'v2')
    await mw(makeCtx(messages))
    expect(messages).toHaveLength(3) // still 3, old one removed
    expect((messages[2]!.content as string)).toContain('v2')
    expect((messages[2]!.content as string)).not.toContain('v1')
  })

  it('works with messages that have no system prefix', async () => {
    store.set('note', 'important')

    const mw = createScratchpadMiddleware(store)
    const messages: IMessage[] = [
      { role: 'user', content: 'Hi there' },
    ]
    await mw(makeCtx(messages))

    expect(messages).toHaveLength(2)
    expect(messages[1]!.role).toBe('user')
    expect((messages[1]!.content as string)).toContain('### note')
  })

  it('removes scratchpad embedded inside a merged message (compaction scenario)', async () => {
    store.set('plan', 'v1')

    const mw = createScratchpadMiddleware(store)

    // Simulate what happens after compaction merges the scratchpad user message
    // into the pinned user message (consecutive user messages get absorbed)
    const embeddedScratchpad =
      'First user message\n\n[Context Summary]\nSome summary\n\n' +
      '<scratchpad>\nBelow are entries you previously saved to the scratchpad during this conversation. ' +
      'These entries are guaranteed to remain visible to you even as older messages are summarized. ' +
      'You can update entries with scratchpad_write or remove them with scratchpad_delete.\n\n' +
      '### plan\nold plan\n</scratchpad>'

    const messages: IMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: embeddedScratchpad },
      { role: 'assistant', content: 'I see.' },
      { role: 'user', content: 'Continue' },
    ]
    await mw(makeCtx(messages))

    // Old embedded scratchpad should be stripped from the merged message
    const pinnedUser = messages[1]!.content as string
    expect(pinnedUser).not.toContain('<scratchpad>')
    expect(pinnedUser).toContain('First user message')
    expect(pinnedUser).toContain('[Context Summary]')

    // New scratchpad should be injected as a separate message
    const scratchpadMsg = messages.find(
      m => typeof m.content === 'string' && (m.content as string).startsWith('<scratchpad>')
    )
    expect(scratchpadMsg).toBeDefined()
    expect((scratchpadMsg!.content as string)).toContain('v1')
  })

  it('removes embedded scratchpad preserving content after end marker', async () => {
    store.set('task', 'current task')

    const mw = createScratchpadMiddleware(store)

    const embeddedContent =
      'Before scratchpad\n\n<scratchpad>\n### old\nold data\n</scratchpad>\n\nAfter scratchpad'

    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: embeddedContent },
      { role: 'assistant', content: 'ok' },
    ]
    await mw(makeCtx(messages))

    const cleaned = messages[1]!.content as string
    expect(cleaned).not.toContain('<scratchpad>')
    expect(cleaned).toContain('Before scratchpad')
    expect(cleaned).toContain('After scratchpad')
  })

  it('removes scratchpad from ContentPart[] when entire text part is scratchpad', async () => {
    store.set('plan', 'new plan')

    const mw = createScratchpadMiddleware(store)

    // Simulate compaction's appendToMessage merging scratchpad into a ContentPart[] message
    // (e.g. pinned user message had an image, scratchpad was appended as a text part)
    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: 'look at this image' },
          { type: 'image' as const, source: { type: 'base64' as const, mediaType: 'image/png', data: 'abc' } },
          { type: 'text' as const, text: '\n\n<scratchpad>\n### old\nold data\n</scratchpad>' },
        ],
      },
      { role: 'assistant', content: 'ok' },
    ]
    await mw(makeCtx(messages))

    // Scratchpad text part should be removed, image and original text preserved
    const parts = messages[1]!.content as any[]
    expect(parts.some((p: any) => p.type === 'text' && p.text.includes('<scratchpad>'))).toBe(false)
    expect(parts.some((p: any) => p.type === 'image')).toBe(true)
    expect(parts.some((p: any) => p.type === 'text' && p.text === 'look at this image')).toBe(true)

    // New scratchpad should be injected
    const scratchpadMsg = messages.find(
      m => typeof m.content === 'string' && (m.content as string).startsWith('<scratchpad>')
    )
    expect(scratchpadMsg).toBeDefined()
    expect((scratchpadMsg!.content as string)).toContain('new plan')
  })

  it('strips scratchpad from ContentPart[] text part that has other text around it', async () => {
    store.set('task', 'latest')

    const mw = createScratchpadMiddleware(store)

    const messages: IMessage[] = [
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: [
          { type: 'text' as const, text: 'original text' },
          { type: 'text' as const, text: 'before pad\n\n<scratchpad>\n### old\nstale\n</scratchpad>\n\nafter pad' },
        ],
      },
      { role: 'assistant', content: 'ok' },
    ]
    await mw(makeCtx(messages))

    const parts = messages[1]!.content as any[]
    const textParts = parts.filter((p: any) => p.type === 'text')
    const allText = textParts.map((p: any) => p.text).join(' ')
    expect(allText).not.toContain('<scratchpad>')
    expect(allText).toContain('before pad')
    expect(allText).toContain('after pad')
  })
})
