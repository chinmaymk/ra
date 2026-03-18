// Node.js compatibility tests — verifies that modules work without Bun APIs.
// Compatible with both `node --test` and `bun test` via node:test.
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
    assert.equal(await fileExists(p), true)
    rmSync(tmp, { recursive: true, force: true })
  })

  it('fileExists returns false for missing file', async () => {
    const { fileExists } = await import('../../src/utils/fs')
    assert.equal(await fileExists('/tmp/does-not-exist-' + Date.now()), false)
  })

  it('readText reads file content', async () => {
    const { readText } = await import('../../src/utils/fs')
    const tmp = makeTmp()
    const p = join(tmp, 'test.txt')
    writeFileSync(p, 'hello world')
    assert.equal(await readText(p), 'hello world')
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
    assert.equal(saved.content, 'test memory')
    assert.equal(saved.tags, 'tag1')
    assert.ok(saved.id > 0)

    const list = store.list()
    assert.equal(list.length, 1)
    assert.equal(list[0].content, 'test memory')

    assert.equal(store.count(), 1)
    store.close()
  })

  it('searches memories via FTS', async () => {
    const { MemoryStore } = await import('../../src/memory/store')
    const store = new MemoryStore({ path: join(tmp, 'mem.db'), maxMemories: 100, ttlDays: 90 })
    store.save('the quick brown fox', 'animals')
    store.save('lazy dog sleeps', 'animals')
    store.save('typescript is great', 'programming')

    const results = store.search('fox')
    assert.equal(results.length, 1)
    assert.equal(results[0].content, 'the quick brown fox')
    store.close()
  })

  it('forgets memories', async () => {
    const { MemoryStore } = await import('../../src/memory/store')
    const store = new MemoryStore({ path: join(tmp, 'mem.db'), maxMemories: 100, ttlDays: 90 })
    store.save('remember this', 'important')
    assert.equal(store.count(), 1)

    const forgotten = store.forget('remember')
    assert.equal(forgotten, 1)
    assert.equal(store.count(), 0)
    store.close()
  })

  it('trims oldest memories when over limit', async () => {
    const { MemoryStore } = await import('../../src/memory/store')
    const store = new MemoryStore({ path: join(tmp, 'mem.db'), maxMemories: 2, ttlDays: 90 })
    store.save('first', '')
    store.save('second', '')
    store.save('third', '')
    assert.equal(store.count(), 3)

    store.trim()
    assert.equal(store.count(), 2)

    const list = store.list()
    assert.deepEqual(list.map(m => m.content).sort(), ['second', 'third'])
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
    await writer.flush()

    const content = readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 2)
    assert.deepEqual(JSON.parse(lines[0]), { event: 'test', value: 42 })
    assert.deepEqual(JSON.parse(lines[1]), { event: 'another' })
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
    assert.equal(messages.length, 2)
    assert.equal(messages[0].content, 'hello')
  })

  it('lists sessions', async () => {
    const { SessionStorage } = await import('../../src/storage/sessions')
    const storage = new SessionStorage(tmp)
    await storage.init()
    await storage.create({ provider: 'test', model: 'test' })
    await storage.create({ provider: 'test', model: 'test' })

    const sessions = await storage.list()
    assert.equal(sessions.length, 2)
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
    assert.ok(server.port > 0)
    await server.stop()
  })
})

describe('config', () => {
  it('loads config from yaml file', async () => {
    const { loadConfig } = await import('../../src/config/index')
    const configDir = makeTmp()
    writeFileSync(join(configDir, 'ra.config.yml'), 'model: gpt-4\nprovider: openai\n')
    const config = await loadConfig({ cwd: configDir })
    assert.equal(config.model, 'gpt-4')
    assert.equal(config.provider, 'openai')
    rmSync(configDir, { recursive: true, force: true })
  })
})
