import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SessionStorage } from '../../src/storage/sessions'

const TEST_PATH = '/tmp/ra-test-sessions'

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
    expect(() => (storage as any).sessionDir('')).toThrow('Invalid session ID')
  })

  it('strips path traversal characters from session IDs', () => {
    // ../../etc/passwd -> etcpasswd (all dots and slashes stripped)
    const dir = (storage as any).sessionDir('../../etc/passwd')
    const idPart = dir.split('/').pop()!
    expect(idPart).toBe('etcpasswd')
    expect(idPart).not.toContain('..')
  })

  it('sanitizes session IDs by stripping non-alphanumeric characters', () => {
    const dir = (storage as any).sessionDir('abc-123_def')
    expect(dir).toContain('abc-123_def')
    // Dots and slashes are stripped from the ID portion
    const dir2 = (storage as any).sessionDir('abc.def/ghi')
    const idPart = dir2.split('/').pop()!
    expect(idPart).toBe('abcdefghi')
    expect(idPart).not.toContain('.')
  })

  it('appendMessage works on a fresh file (no prior messages)', async () => {
    const session = await storage.create({ provider: 'anthropic', model: 'test', interface: 'cli' })
    await storage.appendMessage(session.id, { role: 'user', content: 'first' })
    const messages = await storage.readMessages(session.id)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.content).toBe('first')
  })
})
