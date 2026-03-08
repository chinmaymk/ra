import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { MemoryStore } from '../../src/memory/store'
import { DefaultMemoryExtractor } from '../../src/memory/extractor'
import { memorySearchTool, memorySaveTool } from '../../src/memory/tools'
import { createMemoryMiddleware } from '../../src/memory/middleware'
import type { IMessage } from '../../src/providers/types'

const TMP = join(import.meta.dir, '.tmp-memory')
const DB_PATH = join(TMP, 'test.db')

let store: MemoryStore

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  store = new MemoryStore({ path: DB_PATH, maxSizeMB: 1, ttlDays: 30 })
})

afterEach(() => {
  store.close()
  rmSync(TMP, { recursive: true, force: true })
})

describe('MemoryStore', () => {
  it('saves and retrieves memories', () => {
    const m = store.save('User prefers dark mode', 'preference')
    expect(m.id).toBe(1)
    expect(m.content).toBe('User prefers dark mode')
    expect(m.tags).toBe('preference')

    const all = store.list()
    expect(all).toHaveLength(1)
    expect(all[0]!.content).toBe('User prefers dark mode')
  })

  it('searches memories via FTS', () => {
    store.save('User prefers dark mode', 'preference')
    store.save('Project uses React and TypeScript', 'tech')
    store.save('Deploy to AWS us-east-1', 'infra')

    const results = store.search('React')
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toContain('React')
  })

  it('searches with multiple terms', () => {
    store.save('User prefers dark mode', 'preference')
    store.save('Project uses React and TypeScript', 'tech')

    const results = store.search('React TypeScript')
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toContain('React')
  })

  it('searches tags', () => {
    store.save('Something about infra', 'infrastructure')
    store.save('Something about code', 'development')

    const results = store.search('infrastructure')
    expect(results).toHaveLength(1)
    expect(results[0]!.tags).toBe('infrastructure')
  })

  it('deletes memories', () => {
    const m = store.save('temporary', '')
    expect(store.count()).toBe(1)

    const deleted = store.delete(m.id)
    expect(deleted).toBe(true)
    expect(store.count()).toBe(0)
  })

  it('returns empty for non-matching search', () => {
    store.save('User prefers dark mode', 'preference')
    const results = store.search('golang')
    expect(results).toHaveLength(0)
  })

  it('limits search results', () => {
    for (let i = 0; i < 20; i++) {
      store.save(`Memory ${i}`, 'test')
    }
    const results = store.search('Memory', 5)
    expect(results).toHaveLength(5)
  })

  it('reports count', () => {
    expect(store.count()).toBe(0)
    store.save('one', '')
    store.save('two', '')
    expect(store.count()).toBe(2)
  })

  it('reports database size', () => {
    const size = store.dbSize()
    expect(size).toBeGreaterThan(0)
  })
})

describe('DefaultMemoryExtractor', () => {
  const extractor = new DefaultMemoryExtractor()

  it('extracts [REMEMBER: ...] markers', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: 'Sure! [REMEMBER: User prefers tabs over spaces] I will use tabs.' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.content).toBe('User prefers tabs over spaces')
    expect(entries[0]!.tags).toBe('explicit')
  })

  it('extracts multiple markers from one message', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: '[REMEMBER: Fact A] and also [REMEMBER: Fact B]' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(2)
  })

  it('extracts user preferences', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'I prefer using vim over vscode' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.tags).toBe('user-preference')
  })

  it('extracts corrective statements', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'Actually, use snake_case for variable names' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.tags).toBe('user-preference')
  })

  it('ignores long user messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'I prefer ' + 'x'.repeat(500) },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(0)
  })

  it('ignores unrelated messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'What is the capital of France?' },
      { role: 'assistant', content: 'The capital of France is Paris.' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(0)
  })
})

describe('memory tools', () => {
  it('memory_save tool saves and memory_search tool searches', async () => {
    const saveTool = memorySaveTool(store)
    const searchTool = memorySearchTool(store)

    const saveResult = await saveTool.execute({ content: 'Always use bun instead of node', tags: 'preference,tooling' })
    expect(saveResult).toContain('Memory saved')

    const searchResult = await searchTool.execute({ query: 'bun' })
    expect(searchResult).toContain('Always use bun instead of node')
    expect(searchResult).toContain('preference,tooling')
  })

  it('memory_search returns no-match message', async () => {
    const searchTool = memorySearchTool(store)
    const result = await searchTool.execute({ query: 'nonexistent' })
    expect(result).toBe('No memories found matching that query.')
  })
})

describe('memory middleware', () => {
  it('extracts memories from conversation', async () => {
    const mw = createMemoryMiddleware({ store })

    const messages: IMessage[] = [
      { role: 'user', content: 'I prefer dark mode for all editors' },
      { role: 'assistant', content: 'Got it! [REMEMBER: User prefers dark mode] I will keep that in mind.' },
    ]

    const ctx = {
      messages,
      iteration: 1,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      stop: () => {},
      signal: new AbortController().signal,
    }

    await mw.afterLoopIteration(ctx)

    expect(store.count()).toBeGreaterThanOrEqual(1)
    const results = store.search('dark mode')
    expect(results.length).toBeGreaterThan(0)
  })

  it('prunes on loop begin', async () => {
    const mw = createMemoryMiddleware({ store })

    const ctx = {
      messages: [],
      iteration: 0,
      maxIterations: 10,
      sessionId: 'test',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      stop: () => {},
      signal: new AbortController().signal,
    }

    // Should not throw
    await mw.beforeLoopBegin(ctx)
  })
})
