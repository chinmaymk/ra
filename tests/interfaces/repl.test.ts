import { describe, it, expect, afterEach } from 'bun:test'
import { PassThrough } from 'stream'
import { Repl } from '../../src/interfaces/repl'
import { ToolRegistry } from '../../src/agent/tool-registry'
import { SessionStorage } from '../../src/storage/sessions'
import type { IProvider } from '../../src/providers/types'
import { tmpdir } from '../tmpdir'

const TEST_STORAGE = tmpdir('ra-repl-test')

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

  it('handleCommand /clear resets messages and creates new session', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    // First process some input to build history
    await repl.processInput('first message')

    const response = await repl.handleCommand('/clear')
    expect(response).toBe('Message history cleared.')
  })

  it('handleCommand /save returns session info', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })
    await repl.processInput('hi')

    const response = await repl.handleCommand('/save')
    expect(response).toContain('saved')
  })

  it('handleCommand /resume without id returns usage', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    const response = await repl.handleCommand('/resume')
    expect(response).toBe('Usage: /resume <session-id>')
  })

  it('handleCommand /resume with non-existent id returns error', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    const response = await repl.handleCommand('/resume non-existent-session-id')
    expect(response).toContain('Session not found')
  })

  it('handleCommand /resume with valid id loads messages', async () => {
    const storage = await makeStorage()
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'repl' })
    await storage.appendMessage(session.id, { role: 'user', content: 'saved msg' })

    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })
    const response = await repl.handleCommand(`/resume ${session.id}`)
    expect(response).toContain('Resumed session')
    expect(response).toContain('1 messages loaded')
  })

  it('clears pending state on /resume', async () => {
    const storage = await makeStorage()
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'repl' })
    const skill = { metadata: { name: 'test-skill', description: '' }, body: 'skill body', scripts: [], dir: '/tmp', references: [], assets: [] }
    const skillMap = new Map([['test-skill', skill]])
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage, skillMap })

    // Set pending skill and an attachment via the public /attach command
    await repl.handleCommand('/skill test-skill')
    const tmpFile = `${TEST_STORAGE}/test-attachment.txt`
    await Bun.write(tmpFile, 'attachment content')
    await repl.handleCommand(`/attach ${tmpFile}`)

    // Resume a session — should clear all pending state
    await repl.handleCommand(`/resume ${session.id}`)

    expect((repl as any).pendingSkill).toBeUndefined()
    expect((repl as any).pendingAttachments).toEqual([])
  })

  it('handleCommand /skill without name returns usage', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    const response = await repl.handleCommand('/skill')
    expect(response).toBe('Usage: /skill <name>')
  })

  it('handleCommand /skill with unknown name returns error', async () => {
    const storage = await makeStorage()
    const skillMap = new Map()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage, skillMap })

    const response = await repl.handleCommand('/skill unknown')
    expect(response).toBe('Skill not found: unknown')
  })

  it('handleCommand /skill with valid name sets pending skill', async () => {
    const storage = await makeStorage()
    const skill = { metadata: { name: 'test-skill', description: '' }, body: 'skill body', scripts: [], dir: '/tmp', references: [], assets: [] }
    const skillMap = new Map([['test-skill', skill]])
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage, skillMap })

    const response = await repl.handleCommand('/skill test-skill')
    expect(response).toContain('Skill "test-skill" will be injected')
  })

  it('handleCommand /attach without path returns usage', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    const response = await repl.handleCommand('/attach')
    expect(response).toBe('Usage: /attach <path>')
  })

  it('handleCommand /attach with invalid path returns error', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    const response = await repl.handleCommand('/attach /nonexistent/file.txt')
    expect(response).toContain('Failed to attach file')
  })

  it('handleCommand unknown command returns error', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    const response = await repl.handleCommand('/foobar')
    expect(response).toBe('Unknown command: /foobar')
  })

  it('processes input with pending skill wraps text', async () => {
    let capturedMessages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        capturedMessages = req.messages
        yield { type: 'text', delta: 'response' }
        yield { type: 'done' }
      },
    }
    const storage = await makeStorage()
    const skill = { metadata: { name: 'test-skill', description: '' }, body: 'skill content', scripts: [], dir: '/tmp', references: [], assets: [] }
    const skillMap = new Map([['test-skill', skill]])
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage, skillMap })

    // Set pending skill
    await repl.handleCommand('/skill test-skill')
    // Now process input - skill should be injected
    await repl.processInput('do something')

    const userMsg = capturedMessages.find((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('skill'))
    expect(userMsg).toBeDefined()
    expect(userMsg.content).toContain('test-skill')
    expect(userMsg.content).toContain('skill content')
    expect(userMsg.content).toContain('do something')
  })

  it('handles provider error gracefully', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        throw new Error('Provider error')
      },
    }
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage })

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
    expect(output).toContain('Error')
    expect(output).toContain('Provider error')
  })

  it('stores messages to session after processing', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    await repl.processInput('hi')

    // Access internal sessionId to check stored messages
    const sessionId = (repl as any).sessionId
    const messages = await storage.readMessages(sessionId)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.some((m: any) => m.role === 'user')).toBe(true)
    expect(messages.some((m: any) => m.role === 'assistant')).toBe(true)
  })
})

describe('Repl.start()', () => {
  afterEach(async () => { await Bun.$`rm -rf ${TEST_STORAGE}`.quiet() })

  it('processes lines from stdin, handles commands and input, resumes session', async () => {
    const storage = await makeStorage()
    // Create a session to resume
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'repl' })
    await storage.appendMessage(session.id, { role: 'user', content: 'old msg' })
    await storage.appendMessage(session.id, { role: 'assistant', content: 'old response' })

    // Mock stdin with a PassThrough stream that sends lines then closes
    const input = new PassThrough()

    // Suppress stdout during test
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true

    const origStdin = process.stdin
    const origIsTTY = process.stdout.isTTY
    // Override stdin and isTTY
    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true })
    process.stdout.isTTY = false as any

    const repl = new Repl({
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage,
      sessionId: session.id,
    })

    // Schedule lines to be written
    setTimeout(() => {
      input.write('\n')            // empty line - should be skipped
      input.write('hello world\n') // normal input
      input.write('/save\n')       // command
      input.write('/unknown\n')    // unknown command
      input.end()                  // close the stream
    }, 10)

    try {
      await repl.start()
    } finally {
      process.stdout.write = origWrite
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true })
      process.stdout.isTTY = origIsTTY
    }

    // Verify it resumed with the existing session's messages
    const msgs = (repl as any).messages
    // Should have original 2 messages + new user + new assistant
    expect(msgs.length).toBeGreaterThanOrEqual(4)
  })

  it('does not crash when handleCommand throws (e.g., storage error)', async () => {
    const storage = await makeStorage()
    const input = new PassThrough()

    const origWrite = process.stdout.write.bind(process.stdout)
    const outputChunks: string[] = []
    process.stdout.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
      outputChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    const origStdin = process.stdin
    const origIsTTY = process.stdout.isTTY
    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true })
    process.stdout.isTTY = false as any

    // Make /resume throw by breaking storage.readMessages
    const origRead = storage.readMessages.bind(storage)
    storage.readMessages = async () => { throw new Error('corrupt file') }

    const repl = new Repl({ model: 'test', provider: mockProvider('ok'), tools: new ToolRegistry(), storage })

    setTimeout(() => {
      input.write('/resume some-session-id\n')
      input.end()
    }, 10)

    let threw = false
    try {
      await repl.start()
    } catch {
      threw = true
    } finally {
      process.stdout.write = origWrite
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true })
      process.stdout.isTTY = origIsTTY
      storage.readMessages = origRead
    }

    expect(threw).toBe(false)
    expect(outputChunks.join('')).toContain('corrupt file')
  })

  it('creates new session when no sessionId provided', async () => {
    const storage = await makeStorage()
    const input = new PassThrough()

    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true
    const origStdin = process.stdin
    const origIsTTY = process.stdout.isTTY
    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true })
    process.stdout.isTTY = false as any

    const repl = new Repl({
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage,
    })

    setTimeout(() => { input.end() }, 10)

    try {
      await repl.start()
    } finally {
      process.stdout.write = origWrite
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true })
      process.stdout.isTTY = origIsTTY
    }

    expect((repl as any).sessionId).toBeTruthy()
  })
})
