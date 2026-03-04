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
})
