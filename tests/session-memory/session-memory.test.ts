import { describe, it, expect, beforeEach } from 'bun:test'
import { SessionMemoryStore } from '../../src/session-memory/store'
import { sessionMemoryWriteTool, sessionMemoryDeleteTool } from '../../src/session-memory/tools'
import { createSessionMemoryMiddleware } from '../../src/session-memory/middleware'
import type { IMessage } from '../../src/providers/types'
import type { ModelCallContext } from '../../src/agent/types'

let store: SessionMemoryStore

beforeEach(() => {
  store = new SessionMemoryStore()
})

describe('SessionMemoryStore', () => {
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

describe('session memory tools', () => {
  it('write stores value in the store', async () => {
    const write = sessionMemoryWriteTool(store)
    const result = await write.execute({ key: 'plan', value: 'build the feature' }) as string
    expect(result).toContain('Stored')
    expect(store.get('plan')).toBe('build the feature')
  })

  it('write overwrites existing key', async () => {
    const write = sessionMemoryWriteTool(store)
    await write.execute({ key: 'plan', value: 'v1' })
    await write.execute({ key: 'plan', value: 'v2' })
    expect(store.get('plan')).toBe('v2')
    expect(store.size()).toBe(1)
  })

  it('delete existing key', async () => {
    store.set('task', 'do stuff')
    const del = sessionMemoryDeleteTool(store)
    const result = await del.execute({ key: 'task' }) as string
    expect(result).toContain('Removed')
    expect(store.has('task')).toBe(false)
  })

  it('delete missing key', async () => {
    const del = sessionMemoryDeleteTool(store)
    const result = await del.execute({ key: 'nope' }) as string
    expect(result).toContain('not found')
  })
})

describe('session memory middleware', () => {
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
        stop: () => {},
        signal: new AbortController().signal,
        logger: { debug() {}, info() {}, warn() {}, error() {}, flush: async () => {} } as any,
      },
      stop: () => {},
      signal: new AbortController().signal,
      logger: { debug() {}, info() {}, warn() {}, error() {}, flush: async () => {} } as any,
    }
  }

  it('injects session memory into messages', async () => {
    store.set('plan', 'step 1: research')
    store.set('decisions', 'use bun')

    const mw = createSessionMemoryMiddleware(store)
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
    expect(content).toContain('<session-memory>')
    expect(content).toContain('### plan')
    expect(content).toContain('step 1: research')
    expect(content).toContain('### decisions')
    expect(content).toContain('use bun')
    expect(content).toContain('</session-memory>')
  })

  it('skips injection when store is empty', async () => {
    const mw = createSessionMemoryMiddleware(store)
    const messages: IMessage[] = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hello' },
    ]
    await mw(makeCtx(messages))
    expect(messages).toHaveLength(2)
  })

  it('removes stale injection and re-injects fresh state', async () => {
    store.set('plan', 'v1')

    const mw = createSessionMemoryMiddleware(store)
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

    const mw = createSessionMemoryMiddleware(store)
    const messages: IMessage[] = [
      { role: 'user', content: 'Hi there' },
    ]
    await mw(makeCtx(messages))

    expect(messages).toHaveLength(2)
    expect(messages[1]!.role).toBe('user')
    expect((messages[1]!.content as string)).toContain('### note')
  })
})
