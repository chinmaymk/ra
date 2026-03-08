import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { MemoryStore } from '../../src/memory/store'
import { memorySearchTool, memorySaveTool, memoryForgetTool } from '../../src/memory/tools'
import { createMemoryMiddleware } from '../../src/memory/middleware'
import type { IMessage } from '../../src/providers/types'

const TMP = join(import.meta.dir, '.tmp-memory')
const DB_PATH = join(TMP, 'test.db')

let store: MemoryStore

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  store = new MemoryStore({ path: DB_PATH, maxMemories: 100, ttlDays: 30 })
})

afterEach(() => {
  store.close()
  rmSync(TMP, { recursive: true, force: true })
})

describe('MemoryStore', () => {
  it('saves and retrieves', () => {
    const m = store.save('User prefers dark mode', 'preference')
    expect(m.content).toBe('User prefers dark mode')
    expect(m.tags).toBe('preference')
    expect(store.count()).toBe(1)
  })

  it('searches via FTS', () => {
    store.save('User prefers dark mode', 'preference')
    store.save('Project uses React and TypeScript', 'tech')
    store.save('Deploy to AWS us-east-1', 'infra')

    const results = store.search('React')
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toContain('React')
  })

  it('searches tags', () => {
    store.save('infra stuff', 'infrastructure')
    store.save('code stuff', 'development')
    expect(store.search('infrastructure')).toHaveLength(1)
  })

  it('limits results', () => {
    for (let i = 0; i < 20; i++) store.save(`Memory ${i}`, 'test')
    expect(store.search('Memory', 5)).toHaveLength(5)
  })

  it('returns empty for non-matching', () => {
    store.save('hello world')
    expect(store.search('golang')).toHaveLength(0)
  })

  it('forgets by search query', () => {
    store.save('User prefers tabs', 'preference')
    store.save('User prefers dark mode', 'preference')
    store.save('Project uses Bun', 'tech')

    const deleted = store.forget('prefers')
    expect(deleted).toBe(2)
    expect(store.count()).toBe(1)
  })

  it('forget respects limit', () => {
    for (let i = 0; i < 5; i++) store.save(`Fact about React ${i}`, 'tech')

    const deleted = store.forget('React', 2)
    expect(deleted).toBe(2)
    expect(store.count()).toBe(3)
  })

  it('forget returns 0 for no matches', () => {
    store.save('hello')
    expect(store.forget('nonexistent')).toBe(0)
  })

  it('lists recent memories', () => {
    store.save('first')
    store.save('second')
    store.save('third')
    const list = store.list(2)
    expect(list).toHaveLength(2)
    expect(list[0]!.content).toBe('third')
  })

  it('trims oldest when over maxMemories', () => {
    const small = new MemoryStore({ path: join(TMP, 'trim.db'), maxMemories: 3, ttlDays: 30 })
    for (let i = 0; i < 5; i++) small.save(`Mem ${i}`)
    small.trim()
    expect(small.count()).toBe(3)
    const list = small.list()
    expect(list[0]!.content).toBe('Mem 4')
    expect(list[2]!.content).toBe('Mem 2')
    small.close()
  })
})

describe('memory tools', () => {
  it('memory_save and memory_search', async () => {
    const save = memorySaveTool(store)
    const search = memorySearchTool(store)

    await save.execute({ content: 'Always use bun', tags: 'tooling' })
    const result = await search.execute({ query: 'bun' }) as string
    expect(result).toContain('Always use bun')
    expect(result).toContain('tooling')
  })

  it('memory_search returns message for no matches', async () => {
    const search = memorySearchTool(store)
    expect(await search.execute({ query: 'nothing' })).toBe('No memories found.')
  })

  it('memory_forget deletes matching memories', async () => {
    store.save('User prefers tabs')
    store.save('User prefers dark mode')
    store.save('Unrelated fact')

    const forget = memoryForgetTool(store)
    const result = await forget.execute({ query: 'prefers' }) as string
    expect(result).toContain('Forgot 2')
    expect(store.count()).toBe(1)
  })

  it('memory_forget handles no matches', async () => {
    const forget = memoryForgetTool(store)
    const result = await forget.execute({ query: 'nothing' }) as string
    expect(result).toContain('No matching')
  })
})

describe('memory middleware', () => {
  function makeCtx(messages: IMessage[]): any {
    return {
      messages,
      iteration: 0,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      stop: () => {},
      signal: new AbortController().signal,
    }
  }

  it('injects recalled memories on loop begin', async () => {
    store.save('User prefers dark mode', 'preference')
    store.save('Project uses Bun', 'tech')

    const mw = createMemoryMiddleware({ store })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages))

    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('user')
    const content = messages[0]!.content as string
    expect(content).toContain('<recalled-memories>')
    expect(content).toContain('dark mode')
    expect(content).toContain('Bun')
  })

  it('respects injectLimit', async () => {
    for (let i = 0; i < 10; i++) store.save(`Fact ${i}`)

    const mw = createMemoryMiddleware({ store, injectLimit: 3 })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages))

    const lines = (messages[0]!.content as string).split('\n').filter(l => l.startsWith('- '))
    expect(lines).toHaveLength(3)
  })

  it('skips injection when injectLimit is 0', async () => {
    store.save('something')

    const mw = createMemoryMiddleware({ store, injectLimit: 0 })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages))

    expect(messages).toHaveLength(0)
  })

  it('skips injection when no memories exist', async () => {
    const mw = createMemoryMiddleware({ store })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages))

    expect(messages).toHaveLength(0)
  })
})
