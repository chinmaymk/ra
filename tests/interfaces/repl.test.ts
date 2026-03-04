import { describe, it, expect, afterEach } from 'bun:test'
import { Repl } from '../../src/interfaces/repl'
import { ToolRegistry } from '../../src/agent/tool-registry'
import { SessionStorage } from '../../src/storage/sessions'
import type { IProvider } from '../../src/providers/types'

const TEST_STORAGE = '/tmp/ra-repl-test'

function mockProvider(text: string): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'text', delta: text }
      yield { type: 'done' }
    },
  }
}

async function makeStorage(): Promise<SessionStorage> {
  const storage = new SessionStorage(TEST_STORAGE)
  await storage.init()
  return storage
}

describe('Repl', () => {
  afterEach(async () => { await Bun.$`rm -rf ${TEST_STORAGE}`.quiet() })

  it('processes input without error', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })
    await repl.processInput('hi')
    // No error means success
  })

  it('maintains history across turns', async () => {
    let lastMessages: unknown[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        lastMessages = req.messages
        yield { type: 'text', delta: 'response' }
        yield { type: 'done' }
      },
    }
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage })
    await repl.processInput('first')
    await repl.processInput('second')
    // Should have user + assistant from first turn, plus new user
    expect(lastMessages.length).toBeGreaterThan(1)
  })
})
