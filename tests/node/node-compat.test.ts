// Node.js compatibility tests — verifies that modules work without Bun APIs.
// Run via: npx vitest run tests/node/node-compat.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

function makeTmp(): string {
  const dir = join(tmpdir(), `ra-node-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('utils/fs', () => {
  it('fileExists returns true for existing file', async () => {
    const { fileExists } = await import('../../src/utils/fs')
    const tmp = makeTmp()
    const p = join(tmp, 'test.txt')
    writeFileSync(p, 'hello')
    expect(await fileExists(p)).toBe(true)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('fileExists returns false for missing file', async () => {
    const { fileExists } = await import('../../src/utils/fs')
    expect(await fileExists('/tmp/does-not-exist-' + Date.now())).toBe(false)
  })

  it('readText reads file content', async () => {
    const { readText } = await import('../../src/utils/fs')
    const tmp = makeTmp()
    const p = join(tmp, 'test.txt')
    writeFileSync(p, 'hello world')
    expect(await readText(p)).toBe('hello world')
    rmSync(tmp, { recursive: true, force: true })
  })
})

describe('memory/store', () => {
  let tmp: string

  beforeEach(() => {
    tmp = makeTmp()
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('creates database and saves/retrieves memories', async () => {
    const { MemoryStore } = await import('../../src/memory/store')
    const store = new MemoryStore({ path: join(tmp, 'mem.db'), maxMemories: 100, ttlDays: 90 })
    const saved = store.save('test memory', 'tag1')
    expect(saved.content).toBe('test memory')
    expect(saved.tags).toBe('tag1')
    expect(saved.id).toBeGreaterThan(0)

    const list = store.list()
    expect(list.length).toBe(1)
    expect(list[0].content).toBe('test memory')

    expect(store.count()).toBe(1)
    store.close()
  })

  it('searches memories via FTS', async () => {
    const { MemoryStore } = await import('../../src/memory/store')
    const store = new MemoryStore({ path: join(tmp, 'mem.db'), maxMemories: 100, ttlDays: 90 })
    store.save('the quick brown fox', 'animals')
    store.save('lazy dog sleeps', 'animals')
    store.save('typescript is great', 'programming')

    const results = store.search('fox')
    expect(results.length).toBe(1)
    expect(results[0].content).toBe('the quick brown fox')
    store.close()
  })

  it('forgets memories', async () => {
    const { MemoryStore } = await import('../../src/memory/store')
    const store = new MemoryStore({ path: join(tmp, 'mem.db'), maxMemories: 100, ttlDays: 90 })
    store.save('remember this', 'important')
    expect(store.count()).toBe(1)

    const forgotten = store.forget('remember')
    expect(forgotten).toBe(1)
    expect(store.count()).toBe(0)
    store.close()
  })

  it('trims oldest memories when over limit', async () => {
    const { MemoryStore } = await import('../../src/memory/store')
    const store = new MemoryStore({ path: join(tmp, 'mem.db'), maxMemories: 2, ttlDays: 90 })
    store.save('first', '')
    store.save('second', '')
    store.save('third', '')
    expect(store.count()).toBe(3)

    store.trim()
    expect(store.count()).toBe(2)

    const list = store.list()
    expect(list.map(m => m.content).sort()).toEqual(['second', 'third'])
    store.close()
  })
})

describe('observability/writer', () => {
  let tmp: string

  beforeEach(() => {
    tmp = makeTmp()
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('writes JSONL to file', async () => {
    const { JsonlWriter } = await import('../../src/observability/writer')
    const filePath = join(tmp, 'test.jsonl')
    const writer = new JsonlWriter('file', filePath)
    writer.write({ event: 'test', value: 42 })
    writer.write({ event: 'another' })

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0])).toEqual({ event: 'test', value: 42 })
    expect(JSON.parse(lines[1])).toEqual({ event: 'another' })
  })
})

describe('storage/sessions', () => {
  let tmp: string

  beforeEach(() => {
    tmp = makeTmp()
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('creates and reads sessions', async () => {
    const { SessionStorage } = await import('../../src/storage/sessions')
    const storage = new SessionStorage(tmp)
    await storage.init()
    const session = await storage.create({ provider: 'test', model: 'test' })
    await storage.appendMessage(session.id, { role: 'user', content: 'hello' })
    await storage.appendMessage(session.id, { role: 'assistant', content: 'hi' })

    const messages = await storage.readMessages(session.id)
    expect(messages.length).toBe(2)
    expect(messages[0].content).toBe('hello')
  })

  it('lists sessions', async () => {
    const { SessionStorage } = await import('../../src/storage/sessions')
    const storage = new SessionStorage(tmp)
    await storage.init()
    await storage.create({ provider: 'test', model: 'test' })
    await storage.create({ provider: 'test', model: 'test' })

    const sessions = await storage.list()
    expect(sessions.length).toBe(2)
  })
})

describe('interfaces/http', () => {
  let tmp: string

  beforeEach(() => {
    tmp = makeTmp()
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('starts and stops server', async () => {
    const { HttpServer } = await import('../../src/interfaces/http')
    const mockProvider = {
      name: 'mock',
      chat: async () => ({ content: 'test', toolCalls: [] }),
      stream: async function* () { yield { type: 'done' as const } },
    }
    const { ToolRegistry } = await import('../../src/agent/tool-registry')
    const { SessionStorage } = await import('../../src/storage/sessions')

    const server = new HttpServer({
      port: 0,
      model: 'test',
      provider: mockProvider,
      tools: new ToolRegistry(),
      storage: new SessionStorage(tmp),
    })

    await server.start()
    expect(server.port).toBeGreaterThan(0)
    await server.stop()
  })
})

describe('config', () => {
  it('loads config from yaml file', async () => {
    const { loadConfig } = await import('../../src/config/index')
    const configDir = makeTmp()
    writeFileSync(join(configDir, 'ra.config.yml'), 'model: gpt-4\nprovider: openai\n')
    const config = await loadConfig({ cwd: configDir })
    expect(config.model).toBe('gpt-4')
    expect(config.provider).toBe('openai')
    rmSync(configDir, { recursive: true, force: true })
  })
})
