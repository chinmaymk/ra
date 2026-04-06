import { describe, it, expect, afterEach } from 'bun:test'
import { PassThrough } from 'stream'
import { Repl } from '../../src/interfaces/repl'
import { ToolRegistry } from '@chinmaymk/ra'
import { SessionStorage } from '../../src/storage/sessions'
import type { IProvider, IMessage } from '@chinmaymk/ra'
import type { SkillIndex } from '../../src/skills/types'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from '../tmpdir'
import { mockProvider, mockProviderWithThinking } from '../fixtures'

const TEST_STORAGE = tmpdir('ra-repl-test')

/** Create a skill dir on disk and return a SkillIndex entry. */
function createTestSkill(name: string, body: string, dir?: string): { index: SkillIndex; skillIndex: Map<string, SkillIndex> } {
  const skillDir = dir ?? join(TEST_STORAGE, 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill ${name}\n---\n${body}`)
  const index: SkillIndex = { metadata: { name, description: `Test skill ${name}` }, dir: skillDir }
  return { index, skillIndex: new Map([[name, index]]) }
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

  it('collapses thinking block and shows elapsed time before main text', async () => {
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
    // Collapsed summary with elapsed time should appear
    expect(output).toMatch(/thinking \(\d+\.\d+s\)/)
    // main text should also appear
    expect(output).toContain('hello')
  })

  it('handleCommand /clear resets messages, clears pending state, and creates new session', async () => {
    const storage = await makeStorage()
    const { skillIndex } = createTestSkill('test-skill', 'skill body')
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage, skillIndex })

    // Build up state: process input, set pending skill
    await repl.processInput('first message')
    const oldSessionId = (repl as any).sessionId
    await repl.handleCommand('/skill test-skill')

    const response = await repl.handleCommand('/clear')
    const newSessionId = (repl as any).sessionId

    expect(response).toContain('Session cleared')
    expect(response).toContain(newSessionId)
    expect(newSessionId).not.toBe(oldSessionId)
    expect((repl as any).messages).toEqual([])
    expect((repl as any).pendingSkill).toBeUndefined()
    expect((repl as any).pendingAttachments).toEqual([])
  })

  it('handleCommand /save returns session info', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })
    await repl.processInput('hi')

    const response = await repl.handleCommand('/save')
    expect(response).toContain('saved')
  })

  it('handleCommand /resume without id resumes latest session', async () => {
    const storage = await makeStorage()
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'repl' })
    await storage.appendMessage(session.id, { role: 'user', content: 'old msg' })

    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })
    const response = await repl.handleCommand('/resume')
    expect(response).toContain('Resumed session')
    expect(response).toContain('1 messages loaded')
  })

  it('handleCommand /resume without id picks most recent among multiple sessions', async () => {
    const storage = await makeStorage()
    const s1 = await storage.create({ provider: 'mock', model: 'test', interface: 'repl' })
    await storage.appendMessage(s1.id, { role: 'user', content: 'old session' })
    await new Promise(r => setTimeout(r, 10))
    const s2 = await storage.create({ provider: 'mock', model: 'test', interface: 'repl' })
    await storage.appendMessage(s2.id, { role: 'user', content: 'new session' })

    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })
    const response = await repl.handleCommand('/resume')
    expect(response).toContain(s2.id)
    expect(response).toContain('1 messages loaded')
  })

  it('handleCommand /resume without id and no sessions returns message', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage })

    const response = await repl.handleCommand('/resume')
    expect(response).toBe('No sessions to resume.')
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
    const { skillIndex } = createTestSkill('test-skill', 'skill body')
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage, skillIndex })

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
    expect(response).toBe('Usage: /skill <name>  (or just /<skill-name>)')
  })

  it('handleCommand /skill with unknown name returns error', async () => {
    const storage = await makeStorage()
    const skillIndex = new Map()
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage, skillIndex })

    const response = await repl.handleCommand('/skill unknown')
    expect(response).toBe('Skill not found: unknown')
  })

  it('handleCommand /skill with valid name sets pending skill', async () => {
    const storage = await makeStorage()
    const { skillIndex } = createTestSkill('test-skill', 'skill body')
    const repl = new Repl({ model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage, skillIndex })

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
    const { skillIndex } = createTestSkill('test-skill', 'skill content')
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage, skillIndex })

    // Set pending skill
    await repl.handleCommand('/skill test-skill')
    // Now process input - skill should be injected
    await repl.processInput('do something')

    const userMsg = capturedMessages.find((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('do something'))
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
    expect(output).toContain('✗')
    expect(output).toContain('Provider error')
  })

  it('stores messages to session after processing', async () => {
    const storage = await makeStorage()
    const repl = new Repl({
      model: 'test', provider: mockProvider('hello'), tools: new ToolRegistry(), storage,
    })

    await repl.processInput('hi')

    // Access internal sessionId to check stored messages
    const sessionId = (repl as any).sessionId
    const messages = await storage.readMessages(sessionId)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.some((m: any) => m.role === 'user')).toBe(true)
    expect(messages.some((m: any) => m.role === 'assistant')).toBe(true)
  })
})

describe('Repl interrupt handling', () => {
  afterEach(async () => { await Bun.$`rm -rf ${TEST_STORAGE}`.quiet() })

  it('abort during streaming does not print Error', async () => {
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        yield { type: 'text', delta: 'hello ' }
        await new Promise(resolve => setTimeout(resolve, 300))
        yield { type: 'text', delta: 'world' }
        yield { type: 'done' }
      },
    }
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage })

    const chunks: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }

    const processPromise = repl.processInput('hi')
    await new Promise(resolve => setTimeout(resolve, 50))
    const activeLoop = (repl as any).activeLoop
    expect(activeLoop).not.toBeNull()
    activeLoop.abort()

    try {
      await processPromise
    } finally {
      process.stdout.write = origWrite
    }

    const output = chunks.join('')
    expect(output).not.toContain('Error:')
    expect((repl as any).activeLoop).toBeNull()
  })

  it('repl can process new input after an aborted request', async () => {
    let callCount = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        callCount++
        if (callCount === 1) {
          yield { type: 'text', delta: 'slow ' }
          await new Promise(resolve => setTimeout(resolve, 300))
          yield { type: 'text', delta: 'response' }
        } else {
          yield { type: 'text', delta: 'fast reply' }
        }
        yield { type: 'done' }
      },
    }
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage })

    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = () => true

    try {
      const p1 = repl.processInput('first')
      await new Promise(resolve => setTimeout(resolve, 50));
      (repl as any).activeLoop.abort()
      await p1

      await repl.processInput('second')
    } finally {
      process.stdout.write = origWrite
    }

    expect(callCount).toBe(2)
    const messages = (repl as any).messages
    expect(messages.some((m: any) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('fast reply'))).toBe(true)
  })

  it('Ctrl+D (stream close) prints Goodbye', async () => {
    const storage = await makeStorage()
    const input = new PassThrough()

    const outputChunks: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array) => {
      outputChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    const origStdin = process.stdin
    const origIsTTY = process.stdout.isTTY
    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true })
    process.stdout.isTTY = false as any

    const repl = new Repl({ model: 'test', provider: mockProvider('ok'), tools: new ToolRegistry(), storage })

    setTimeout(() => { input.end() }, 10)

    try {
      await repl.start()
    } finally {
      process.stdout.write = origWrite
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true })
      process.stdout.isTTY = origIsTTY
    }

    const output = outputChunks.join('')
    expect(output).toContain('Goodbye!')
  })

  it('double Ctrl+C prints Goodbye exactly once', async () => {
    const storage = await makeStorage()
    const input = new PassThrough()

    const outputChunks: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = (chunk: string | Uint8Array) => {
      outputChunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }
    const origStdin = process.stdin
    const origIsTTY = process.stdout.isTTY
    Object.defineProperty(process, 'stdin', { value: input, writable: true, configurable: true })
    process.stdout.isTTY = true as any

    const repl = new Repl({ model: 'test', provider: mockProvider('ok'), tools: new ToolRegistry(), storage })

    // Send two Ctrl+C keypresses (0x03) in quick succession to trigger exit
    setTimeout(() => {
      input.write('\x03')
      setTimeout(() => input.write('\x03'), 50)
    }, 10)

    try {
      await repl.start()
    } finally {
      process.stdout.write = origWrite
      Object.defineProperty(process, 'stdin', { value: origStdin, writable: true, configurable: true })
      process.stdout.isTTY = origIsTTY
    }

    const output = outputChunks.join('')
    const goodbyeCount = output.split('Goodbye!').length - 1
    expect(goodbyeCount).toBe(1)
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

  it('does not duplicate system prompt across multiple turns', async () => {
    const requestMessages: IMessage[][] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        requestMessages.push([...req.messages])
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage, systemPrompt: 'be helpful' })

    await repl.processInput('turn 1')
    await repl.processInput('turn 2')
    await repl.processInput('turn 3')

    // Each turn should have exactly one system message
    for (let i = 0; i < requestMessages.length; i++) {
      const systemMsgs = requestMessages[i]!.filter(m => m.role === 'system')
      expect(systemMsgs.length).toBe(1)
      expect(systemMsgs[0]?.content).toBe('be helpful')
    }

    // Turn 3 should have: system + user1 + assistant1 + user2 + assistant2 + user3
    const turn3 = requestMessages[2]!
    expect(turn3.length).toBe(6)
    expect(turn3[0]?.role).toBe('system')
    const userMsgs = turn3.filter(m => m.role === 'user')
    expect(userMsgs.map(m => m.content)).toEqual(['turn 1', 'turn 2', 'turn 3'])
  })

  it('does not duplicate prefix after /resume', async () => {
    const storage = await makeStorage()

    // Create a session with system prompt + one exchange
    const provider1: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        yield { type: 'text', delta: 'first response' }
        yield { type: 'done' }
      },
    }
    const repl1 = new Repl({ model: 'test', provider: provider1, tools: new ToolRegistry(), storage, systemPrompt: 'be helpful' })
    await repl1.processInput('hello')
    const sessionId = (repl1 as any).sessionId as string

    // Resume the session in a new REPL and capture what goes to the model
    let resumedMessages: IMessage[] = []
    const provider2: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        resumedMessages = [...req.messages]
        yield { type: 'text', delta: 'resumed response' }
        yield { type: 'done' }
      },
    }
    const repl2 = new Repl({ model: 'test', provider: provider2, tools: new ToolRegistry(), storage, systemPrompt: 'be helpful' })
    await repl2.handleCommand(`/resume ${sessionId}`)
    await repl2.processInput('follow up')

    // Should have exactly one system message (from stored), not two
    const systemMsgs = resumedMessages.filter(m => m.role === 'system')
    expect(systemMsgs.length).toBe(1)

    // Should have: system, user(hello), assistant(first response), user(follow up)
    expect(resumedMessages.length).toBe(4)
    expect(resumedMessages[0]?.role).toBe('system')
    expect(resumedMessages[1]?.content).toBe('hello')
    expect(resumedMessages[2]?.content).toBe('first response')
    expect(resumedMessages[3]?.content).toBe('follow up')
  })

  it('persists messages correctly on first turn (no duplicates on disk)', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('response'), tools: new ToolRegistry(), storage, systemPrompt: 'sys' })
    await repl.processInput('hello')

    const sessionId = (repl as any).sessionId as string
    const stored = await storage.readMessages(sessionId)

    // Disk: system + user + assistant = 3 messages, each appearing once
    expect(stored.length).toBe(3)
    expect(stored.filter(m => m.role === 'system').length).toBe(1)
    expect(stored.filter(m => m.role === 'user').length).toBe(1)
    expect(stored.filter(m => m.role === 'assistant').length).toBe(1)
  })

  it('persists messages correctly across multiple turns (no duplicates on disk)', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('ok'), tools: new ToolRegistry(), storage, systemPrompt: 'sys' })
    await repl.processInput('turn 1')
    await repl.processInput('turn 2')

    const sessionId = (repl as any).sessionId as string
    const stored = await storage.readMessages(sessionId)

    // system + user1 + assistant1 + user2 + assistant2 = 5
    expect(stored.length).toBe(5)
    expect(stored.filter(m => m.role === 'system').length).toBe(1)
    expect(stored.filter(m => m.role === 'user').length).toBe(2)
    expect(stored.filter(m => m.role === 'assistant').length).toBe(2)
  })

  it('/clear creates a new session and isolates messages on disk', async () => {
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider: mockProvider('ok'), tools: new ToolRegistry(), storage, systemPrompt: 'sys' })

    // First turn in original session
    await repl.processInput('before clear')
    const oldSessionId = (repl as any).sessionId as string
    const oldStored = await storage.readMessages(oldSessionId)
    expect(oldStored.length).toBe(3) // system + user + assistant

    // Clear and start a new session
    await repl.handleCommand('/clear')
    const newSessionId = (repl as any).sessionId as string
    expect(newSessionId).not.toBe(oldSessionId)

    // New session should have no messages yet
    const newStoredBefore = await storage.readMessages(newSessionId)
    expect(newStoredBefore.length).toBe(0)

    // Send a message in the new session
    await repl.processInput('after clear')
    const newStored = await storage.readMessages(newSessionId)
    expect(newStored.length).toBe(3) // system + user + assistant
    expect(newStored.some(m => typeof m.content === 'string' && m.content.includes('before clear'))).toBe(false)
    expect(newStored.some(m => typeof m.content === 'string' && m.content.includes('after clear'))).toBe(true)

    // Old session should be unchanged
    const oldStoredAfter = await storage.readMessages(oldSessionId)
    expect(oldStoredAfter.length).toBe(3)
  })

  it('/clear prevents old messages from reaching the model', async () => {
    const requestMessages: IMessage[][] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        requestMessages.push([...req.messages])
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }
    const storage = await makeStorage()
    const repl = new Repl({ model: 'test', provider, tools: new ToolRegistry(), storage, systemPrompt: 'sys' })

    await repl.processInput('first turn')
    await repl.handleCommand('/clear')
    await repl.processInput('fresh start')

    // The second model call (after /clear) should only have system + user — no prior history
    const postClearReq = requestMessages[1]!
    expect(postClearReq.filter(m => m.role === 'system').length).toBe(1)
    const userMsgs = postClearReq.filter(m => m.role === 'user')
    expect(userMsgs.length).toBe(1)
    expect(JSON.stringify(userMsgs[0]?.content)).toContain('fresh start')
    expect(JSON.stringify(postClearReq)).not.toContain('first turn')
  })
})
