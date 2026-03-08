import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { MemoryStore } from '../../src/memory/store'
import { PatternExtractor, ReflectiveExtractor, DEFAULT_PATTERNS } from '../../src/memory/extractor'
import type { ExtractionPattern } from '../../src/memory/extractor'
import { memorySearchTool, memorySaveTool } from '../../src/memory/tools'
import { createMemoryMiddleware } from '../../src/memory/middleware'
import type { IMessage, IProvider, ChatResponse, StreamChunk } from '../../src/providers/types'

const TMP = join(import.meta.dir, '.tmp-memory')
const DB_PATH = join(TMP, 'test.db')

let store: MemoryStore

beforeEach(() => {
  rmSync(TMP, { recursive: true, force: true })
  store = new MemoryStore({ path: DB_PATH, maxSizeMB: 1, ttlDays: 30, sessionTTLHours: 24 })
})

afterEach(() => {
  store.close()
  rmSync(TMP, { recursive: true, force: true })
})

describe('MemoryStore — layered', () => {
  it('saves to session by default', () => {
    const m = store.save('User prefers dark mode')
    expect(m.layer).toBe('session')
    expect(m.sessionId).toBe('')
  })

  it('saves to session layer with sessionId', () => {
    const m = store.save('Current task is refactoring auth', { layer: 'session', sessionId: 'sess-1' })
    expect(m.layer).toBe('session')
    expect(m.sessionId).toBe('sess-1')
  })

  it('searches across all layers', () => {
    store.save('dark mode preference', { layer: 'long-term' })
    store.save('dark theme in current session', { layer: 'session', sessionId: 'sess-1' })
    const results = store.search('dark')
    expect(results).toHaveLength(2)
  })

  it('searches filtered by layer', () => {
    store.save('dark mode preference', { layer: 'long-term' })
    store.save('dark theme in session', { layer: 'session', sessionId: 'sess-1' })
    expect(store.search('dark', { layer: 'long-term' })).toHaveLength(1)
    expect(store.search('dark', { layer: 'session' })).toHaveLength(1)
  })

  it('filters by sessionId', () => {
    store.save('task A context', { layer: 'session', sessionId: 'sess-1' })
    store.save('task B context', { layer: 'session', sessionId: 'sess-2' })
    expect(store.search('context', { sessionId: 'sess-1' })).toHaveLength(1)
  })

  it('getSessionContext returns session memories for a session', () => {
    store.save('task context A', { layer: 'session', sessionId: 'sess-1' })
    store.save('task context B', { layer: 'session', sessionId: 'sess-1' })
    store.save('unrelated', { layer: 'session', sessionId: 'sess-2' })
    store.save('long-term fact', { layer: 'long-term' })

    const ctx = store.getSessionContext('sess-1')
    expect(ctx).toHaveLength(2)
    expect(ctx.every(m => m.sessionId === 'sess-1')).toBe(true)
  })

  it('promotes session memory to long-term', () => {
    const m = store.save('important finding', { layer: 'session', sessionId: 'sess-1' })
    expect(store.promote(m.id)).toBe(true)

    const all = store.list({ layer: 'long-term' })
    expect(all.some(x => x.content === 'important finding')).toBe(true)

    const sessions = store.list({ layer: 'session' })
    expect(sessions.some(x => x.content === 'important finding')).toBe(false)
  })

  it('counts per layer', () => {
    store.save('a', { layer: 'long-term' })
    store.save('b', { layer: 'session', sessionId: 's' })
    store.save('c', { layer: 'session', sessionId: 's' })
    expect(store.count()).toBe(3)
    expect(store.count('long-term')).toBe(1)
    expect(store.count('session')).toBe(2)
  })

  it('deletes memories', () => {
    const m = store.save('temporary')
    expect(store.delete(m.id)).toBe(true)
    expect(store.count()).toBe(0)
  })

  it('enforceMaxSize removes session memories first', () => {
    // Fill with a mix of session and long-term
    for (let i = 0; i < 50; i++) {
      store.save(`session item ${i}`, { layer: 'session', sessionId: 's' })
    }
    store.save('important long-term fact', { layer: 'long-term' })

    // After enforcement, long-term should survive longer than session
    store.enforceMaxSize()
    const lt = store.list({ layer: 'long-term' })
    expect(lt.some(m => m.content === 'important long-term fact')).toBe(true)
  })
})

describe('MemoryStore — FTS', () => {
  it('searches with multiple terms', () => {
    store.save('Project uses React and TypeScript', { tags: 'tech' })
    store.save('Deploy to AWS', { tags: 'infra' })
    const results = store.search('React TypeScript')
    expect(results).toHaveLength(1)
  })

  it('searches tags', () => {
    store.save('Something about infra', { tags: 'infrastructure' })
    store.save('Something about code', { tags: 'development' })
    const results = store.search('infrastructure')
    expect(results).toHaveLength(1)
  })

  it('limits results', () => {
    for (let i = 0; i < 20; i++) store.save(`Memory ${i}`, { tags: 'test' })
    expect(store.search('Memory', { limit: 5 })).toHaveLength(5)
  })

  it('returns empty for non-matching', () => {
    store.save('hello world')
    expect(store.search('golang')).toHaveLength(0)
  })
})

describe('PatternExtractor', () => {
  const extractor = new PatternExtractor()

  it('extracts [REMEMBER: ...] markers as session', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: 'Sure! [REMEMBER: User prefers tabs over spaces] I will use tabs.' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.content).toBe('User prefers tabs over spaces')
    expect(entries[0]!.tags).toBe('explicit')
    expect(entries[0]!.layer).toBe('session')
  })

  it('extracts multiple markers from one message', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: '[REMEMBER: Fact A] and also [REMEMBER: Fact B]' },
    ]
    expect(extractor.extract(messages)).toHaveLength(2)
  })

  it('extracts user preferences as session', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'I prefer using vim over vscode' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.tags).toBe('user-preference')
    expect(entries[0]!.layer).toBe('session')
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
    expect(extractor.extract(messages)).toHaveLength(0)
  })

  it('ignores unrelated messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'What is the capital of France?' },
      { role: 'assistant', content: 'The capital of France is Paris.' },
    ]
    expect(extractor.extract(messages)).toHaveLength(0)
  })

  it('deduplicates within a pass', () => {
    const messages: IMessage[] = [
      { role: 'assistant', content: '[REMEMBER: same thing] and [REMEMBER: same thing]' },
    ]
    expect(extractor.extract(messages)).toHaveLength(1)
  })
})

describe('PatternExtractor — custom patterns', () => {
  it('uses custom patterns alongside defaults', () => {
    const customPatterns: ExtractionPattern[] = [
      ...DEFAULT_PATTERNS,
      {
        pattern: 'TODO:\\s*(.+)',
        tag: 'todo',
        layer: 'session',
        capture: 'match',
      },
    ]
    const extractor = new PatternExtractor(customPatterns)
    const messages: IMessage[] = [
      { role: 'assistant', content: 'TODO: Fix the auth bug before release' },
    ]
    const entries = extractor.extract(messages)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.content).toBe('Fix the auth bug before release')
    expect(entries[0]!.tags).toBe('todo')
    expect(entries[0]!.layer).toBe('session')
  })

  it('respects role filtering', () => {
    const patterns: ExtractionPattern[] = [
      { pattern: 'NOTE:\\s*(.+)', tag: 'note', roles: ['assistant'], capture: 'match' },
    ]
    const extractor = new PatternExtractor(patterns)

    // Should match assistant
    expect(extractor.extract([
      { role: 'assistant', content: 'NOTE: important thing' },
    ])).toHaveLength(1)

    // Should not match user
    expect(extractor.extract([
      { role: 'user', content: 'NOTE: important thing' },
    ])).toHaveLength(0)
  })

  it('respects maxLength filtering', () => {
    const patterns: ExtractionPattern[] = [
      { pattern: 'short', tag: 'test', maxLength: 20, capture: 'full' },
    ]
    const extractor = new PatternExtractor(patterns)

    expect(extractor.extract([
      { role: 'user', content: 'short' },
    ])).toHaveLength(1)

    expect(extractor.extract([
      { role: 'user', content: 'this is a very long message that contains short somewhere' },
    ])).toHaveLength(0)
  })
})

describe('ReflectiveExtractor', () => {
  function mockProvider(responseContent: string): IProvider {
    return {
      name: 'mock',
      async chat() {
        return { message: { role: 'assistant', content: responseContent } } as ChatResponse
      },
      async *stream(): AsyncIterable<StreamChunk> {
        yield { type: 'done' }
      },
    }
  }

  it('extracts learnings as long-term via LLM', async () => {
    const provider = mockProvider(JSON.stringify([
      { content: 'User prefers functional style', tags: 'preference,code-style' },
      { content: 'Project uses TypeScript strictly', tags: 'project' },
    ]))

    const extractor = new ReflectiveExtractor(provider)
    const messages: IMessage[] = [
      { role: 'user', content: 'Please refactor this to use functional patterns' },
      { role: 'assistant', content: 'I will refactor the auth service to use functional patterns as you prefer.' },
    ]

    const entries = await extractor.extractAsync(messages)
    expect(entries).toHaveLength(2)
    expect(entries[0]!.layer).toBe('long-term')
    expect(entries[1]!.layer).toBe('long-term')
  })

  it('handles LLM returning markdown-wrapped JSON', async () => {
    const provider = mockProvider('```json\n[{"content": "fact", "tags": "test"}]\n```')
    const extractor = new ReflectiveExtractor(provider)
    const messages: IMessage[] = [
      { role: 'user', content: 'Do something interesting' },
      { role: 'assistant', content: 'Here is the interesting result' },
    ]
    const entries = await extractor.extractAsync(messages)
    expect(entries).toHaveLength(1)
  })

  it('returns empty on LLM error', async () => {
    const provider: IProvider = {
      name: 'mock',
      async chat() { throw new Error('API error') },
      async *stream(): AsyncIterable<StreamChunk> { yield { type: 'done' } },
    }
    const extractor = new ReflectiveExtractor(provider)
    const entries = await extractor.extractAsync([
      { role: 'user', content: 'hello there' },
      { role: 'assistant', content: 'hi back' },
    ])
    expect(entries).toHaveLength(0)
  })

  it('returns empty for short conversations', async () => {
    const provider = mockProvider('[]')
    const extractor = new ReflectiveExtractor(provider)
    const entries = await extractor.extractAsync([
      { role: 'user', content: 'hi' },
    ])
    expect(entries).toHaveLength(0)
  })

  it('synchronous extract returns empty', () => {
    const provider = mockProvider('[]')
    const extractor = new ReflectiveExtractor(provider)
    expect(extractor.extract([])).toHaveLength(0)
  })

  it('uses custom reflection prompt', async () => {
    let capturedPrompt = ''
    const provider: IProvider = {
      name: 'mock',
      async chat(req) {
        capturedPrompt = typeof req.messages[0]!.content === 'string' ? req.messages[0]!.content : ''
        return { message: { role: 'assistant', content: '[]' } } as ChatResponse
      },
      async *stream(): AsyncIterable<StreamChunk> { yield { type: 'done' } },
    }

    const customPrompt = 'Extract key facts from this conversation:\n{CONVERSATION}\nReturn JSON array.'
    const extractor = new ReflectiveExtractor(provider, undefined, customPrompt)
    await extractor.extractAsync([
      { role: 'user', content: 'I like TypeScript' },
      { role: 'assistant', content: 'TypeScript is great!' },
    ])

    expect(capturedPrompt).toContain('Extract key facts')
    expect(capturedPrompt).toContain('I like TypeScript')
    expect(capturedPrompt).not.toContain('memory extraction system')
  })
})

describe('memory tools — layered', () => {
  it('memory_save defaults to session', async () => {
    const tool = memorySaveTool(store)
    await tool.execute({ content: 'Always use bun', tags: 'tooling' })
    expect(store.count('session')).toBe(1)
  })

  it('memory_save supports long-term layer', async () => {
    const tool = memorySaveTool(store)
    await tool.execute({ content: 'User prefers tabs', layer: 'long-term' })
    expect(store.count('long-term')).toBe(1)
  })

  it('memory_search filters by layer', async () => {
    store.save('long-term fact about bun', { layer: 'long-term' })
    store.save('session fact about bun', { layer: 'session', sessionId: 's' })

    const tool = memorySearchTool(store)
    const ltResult = await tool.execute({ query: 'bun', layer: 'long-term' }) as string
    expect(ltResult).toContain('long-term fact')
    expect(ltResult).not.toContain('session fact')
  })

  it('memory_search shows layer in output', async () => {
    store.save('something useful', { layer: 'long-term' })
    const tool = memorySearchTool(store)
    const result = await tool.execute({ query: 'useful' }) as string
    expect(result).toContain('long-term')
  })

})

describe('memory middleware — layered', () => {
  function makeCtx(messages: IMessage[], iteration = 1): any {
    return {
      messages,
      iteration,
      maxIterations: 10,
      sessionId: 'test-session',
      usage: { inputTokens: 0, outputTokens: 0 },
      lastUsage: undefined,
      stop: () => {},
      signal: new AbortController().signal,
    }
  }

  it('pattern extraction saves to store with session info', async () => {
    const mw = createMemoryMiddleware({ store })
    const messages: IMessage[] = [
      { role: 'assistant', content: '[REMEMBER: User likes dark mode]' },
    ]
    await mw.afterLoopIteration(makeCtx(messages))

    const results = store.search('dark mode')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.sessionId).toBe('test-session')
  })

  it('reflective extraction runs on loop complete', async () => {
    const provider: IProvider = {
      name: 'mock',
      async chat() {
        return {
          message: {
            role: 'assistant',
            content: JSON.stringify([
              { content: 'User prefers functional code', tags: 'preference', layer: 'long-term' },
            ]),
          },
        } as ChatResponse
      },
      async *stream(): AsyncIterable<StreamChunk> { yield { type: 'done' } },
    }

    const mw = createMemoryMiddleware({ store, provider })
    const messages: IMessage[] = [
      { role: 'user', content: 'Refactor to functional style please' },
      { role: 'assistant', content: 'Done! I refactored everything to use pure functions.' },
    ]

    await mw.afterLoopComplete(makeCtx(messages))

    const results = store.search('functional')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]!.layer).toBe('long-term')
  })

  it('skips reflection without provider', async () => {
    const mw = createMemoryMiddleware({ store })
    await mw.afterLoopComplete(makeCtx([]))
    expect(store.count()).toBe(0)
  })

  it('injects recalled memories as user message on loop begin', async () => {
    store.save('User prefers dark mode', { layer: 'long-term', tags: 'preference' })
    store.save('Working on auth service', { layer: 'session', sessionId: 'test-session', tags: 'context' })

    const mw = createMemoryMiddleware({ store })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages, 0))

    expect(messages).toHaveLength(1)
    expect(messages[0]!.role).toBe('user')
    const content = messages[0]!.content as string
    expect(content).toContain('<recalled-memories>')
    expect(content).toContain('User prefers dark mode')
    expect(content).toContain('Working on auth service')
  })

  it('respects injectLimit', async () => {
    for (let i = 0; i < 10; i++) {
      store.save(`Fact ${i}`, { layer: 'long-term' })
    }

    const mw = createMemoryMiddleware({ store, injectLimit: 3 })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages, 0))

    const content = messages[0]!.content as string
    // Should only have 3 lines (most recent)
    const lines = content.split('\n').filter(l => l.startsWith('- '))
    expect(lines).toHaveLength(3)
  })

  it('skips injection when injectLimit is 0', async () => {
    store.save('Some fact', { layer: 'long-term' })

    const mw = createMemoryMiddleware({ store, injectLimit: 0 })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages, 0))

    expect(messages).toHaveLength(0)
  })

  it('skips injection when no memories exist', async () => {
    const mw = createMemoryMiddleware({ store })
    const messages: IMessage[] = []
    await mw.beforeLoopBegin(makeCtx(messages, 0))

    expect(messages).toHaveLength(0)
  })
})
