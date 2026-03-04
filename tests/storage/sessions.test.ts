import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SessionStorage } from '../../src/storage/sessions'
import { tmpdir } from '../tmpdir'

const TEST_PATH = tmpdir('ra-test-sessions')

describe('SessionStorage', () => {
  let storage: SessionStorage

  beforeEach(async () => {
    storage = new SessionStorage(TEST_PATH)
    await storage.init()
  })
  afterEach(async () => { await Bun.$`rm -rf ${TEST_PATH}`.quiet() })

  it('creates a new session', async () => {
    const session = await storage.create({ provider: 'anthropic', model: 'claude-sonnet-4-6', interface: 'cli' })
    expect(session.id).toBeDefined()
    expect(session.meta.provider).toBe('anthropic')
  })

  it('appends and reads messages', async () => {
    const session = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
    await storage.appendMessage(session.id, { role: 'user', content: 'hello' })
    await storage.appendMessage(session.id, { role: 'assistant', content: 'hi' })
    const messages = await storage.readMessages(session.id)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.content).toBe('hello')
  })

  it('saves and loads checkpoint', async () => {
    const session = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
    await storage.saveCheckpoint(session.id, { iteration: 3 })
    const checkpoint = await storage.loadCheckpoint(session.id)
    expect(checkpoint?.iteration).toBe(3)
  })

  it('lists all sessions', async () => {
    await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
    await storage.create({ provider: 'openai', model: 'gpt-4o', interface: 'repl' })
    const list = await storage.list()
    expect(list).toHaveLength(2)
  })

  it('prunes sessions over maxSessions', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
      await new Promise(r => setTimeout(r, 10)) // ensure different timestamps
    }
    await storage.prune({ maxSessions: 3 })
    const list = await storage.list()
    expect(list).toHaveLength(3)
  })

  it('appendMessage does not lose data under concurrent writes', async () => {
    const session = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
    const count = 20
    // Fire all appends concurrently
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        storage.appendMessage(session.id, { role: 'user', content: `msg-${i}` })
      )
    )
    const messages = await storage.readMessages(session.id)
    expect(messages).toHaveLength(count)
    // Verify all messages are present (order may vary due to concurrency)
    const contents = new Set(messages.map(m => m.content as string))
    for (let i = 0; i < count; i++) {
      expect(contents.has(`msg-${i}`)).toBe(true)
    }
  })

  it('rejects empty session IDs', async () => {
    expect(() => storage.sessionDir('')).toThrow('Invalid session ID')
  })

  it('strips path traversal characters from session IDs', () => {
    // ../../etc/passwd -> etcpasswd (all dots and slashes stripped)
    const dir = storage.sessionDir('../../etc/passwd')
    const idPart = dir.split('/').pop()!
    expect(idPart).toBe('etcpasswd')
    expect(idPart).not.toContain('..')
  })

  it('sanitizes session IDs by stripping non-alphanumeric characters', () => {
    const dir = storage.sessionDir('abc-123_def')
    expect(dir).toContain('abc-123_def')
    // Dots and slashes are stripped from the ID portion
    const dir2 = storage.sessionDir('abc.def/ghi')
    const idPart = dir2.split('/').pop()!
    expect(idPart).toBe('abcdefghi')
    expect(idPart).not.toContain('.')
  })

  it('prune with both TTL and maxSessions deletes correct count', async () => {
    for (let i = 0; i < 10; i++) {
      const s = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
      if (i < 2) {
        const { join } = await import('path')
        const metaPath = join(TEST_PATH, s.id, 'meta.json')
        const meta = JSON.parse(await Bun.file(metaPath).text())
        meta.created = new Date(Date.now() - 2 * 86_400_000).toISOString()
        await Bun.write(metaPath, JSON.stringify(meta, null, 2))
      }
      await new Promise(r => setTimeout(r, 10))
    }
    await storage.prune({ ttlDays: 1, maxSessions: 7 })
    const list = await storage.list()
    expect(list).toHaveLength(7)
  })

  it('prune() respects maxSessions exactly — keeps newest, deletes oldest', async () => {
    const maxSessions = 3
    const limitedStorage = new SessionStorage(TEST_PATH + '-limited')
    await limitedStorage.init()

    // Create 5 sessions
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      const session = await limitedStorage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
      ids.push(session.id)
      // Small delay so created timestamp differs
      await new Promise(r => setTimeout(r, 10))
    }

    await limitedStorage.prune({ maxSessions })
    const remaining = await limitedStorage.list()
    expect(remaining).toHaveLength(maxSessions)
    const remainingIds = remaining.map(s => s.id)
    // The newest sessions should survive
    expect(remainingIds).toContain(ids[4]!)
    expect(remainingIds).toContain(ids[3]!)
    expect(remainingIds).toContain(ids[2]!)
    // The oldest should be gone
    expect(remainingIds).not.toContain(ids[0]!)
    expect(remainingIds).not.toContain(ids[1]!)

    await Bun.$`rm -rf ${TEST_PATH + '-limited'}`.quiet()
  })

  it('readMessages skips malformed JSONL lines instead of throwing', async () => {
    const { join } = await import('path')
    const { appendFile: nodeAppendFile } = await import('node:fs/promises')
    const session = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
    await storage.appendMessage(session.id, { role: 'user', content: 'good message' })
    const filePath = join(TEST_PATH, session.id, 'messages.jsonl')
    await nodeAppendFile(filePath, '{corrupt json\n')
    await storage.appendMessage(session.id, { role: 'assistant', content: 'another good message' })
    const messages = await storage.readMessages(session.id)
    expect(messages).toHaveLength(2)
    expect(messages[0]?.content).toBe('good message')
    expect(messages[1]?.content).toBe('another good message')
  })

})
