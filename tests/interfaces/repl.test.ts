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

function mockProviderWithThinking(thinkingDelta: string, textDelta: string): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'thinking', delta: thinkingDelta }
      yield { type: 'text', delta: textDelta }
      yield { type: 'done' }
    },
  }
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

  it('renders thinking chunks dimmed before main text', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProviderWithThinking('hmm', 'hello'), tools: new ToolRegistry(), storage })

    const chunks: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return origWrite(chunk, ...(args as []))
    }

    try {
      await repl.processInput('test')
    } finally {
      process.stdout.write = origWrite
    }

    const output = chunks.join('')
    // dim ANSI code should appear before the thinking delta
    const dimIndex = output.indexOf('\x1b[2m')
    const hmmIndex = output.indexOf('hmm')
    expect(dimIndex).toBeGreaterThanOrEqual(0)
    expect(hmmIndex).toBeGreaterThan(dimIndex)
    // main text should also appear
    expect(output).toContain('hello')
  })
})
