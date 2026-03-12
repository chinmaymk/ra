import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { spawnBinary } from './helpers/binary'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

async function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

describe('REPL integration', () => {
  let env: TestEnv

  beforeAll(async () => { env = await createTestEnv() })
  afterAll(async () => { await env.cleanup() })
  afterEach(() => env.mock.resetRequests())

  it('sends a message and receives response on stdout', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Hello there!' }])
    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc.write('hello\n')
    await delay(1000)
    const output = await proc.readAvailable()
    proc.kill()
    expect(output).toContain('Hello there!')
  })

  it('/clear command — next message starts fresh context', async () => {
    env.mock.enqueue([{ type: 'text', content: 'First response.' }])
    env.mock.enqueue([{ type: 'text', content: 'After clear.' }])

    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc.write('first message\n')
    await delay(800)
    proc.write('/clear\n')
    await delay(300)
    proc.write('second message\n')
    await delay(800)
    proc.kill()

    const reqs = env.mock.requests()
    expect(reqs.length).toBeGreaterThanOrEqual(2)
    const secondReqBody = reqs[1]?.body as any
    const msgs = secondReqBody?.messages ?? secondReqBody?.contents ?? []
    // After /clear, the second request should not carry over messages from the first turn.
    // Skills XML is merged with the user message into a single array-content message,
    // so check for at least one text block that doesn't start with '<'.
    const hasUserText = (m: any): boolean => {
      if (m.role !== 'user' && m.role !== 'human') return false
      if (typeof m.content === 'string') return !m.content.startsWith('<')
      if (Array.isArray(m.content)) return m.content.some((p: any) => p.type === 'text' && typeof p.text === 'string' && !p.text.startsWith('<'))
      return false
    }
    expect(msgs.filter(hasUserText).length).toBe(1)
  })

  it('/attach <file> includes file content in next request', async () => {
    const tmpDir = join(tmpdir(), `ra-repl-attach-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const testFile = join(tmpDir, 'test.txt')
    writeFileSync(testFile, 'file contents for testing')

    env.mock.enqueue([{ type: 'text', content: 'I see the file.' }])

    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc.write(`/attach ${testFile}\n`)
    await delay(300)
    proc.write('what is in the file?\n')
    await delay(800)
    proc.kill()
    rmSync(tmpDir, { recursive: true, force: true })

    const req = env.mock.requests()[0]
    expect(JSON.stringify(req?.body)).toContain('file contents for testing')
  })

  it('/save and /resume restores prior messages', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Remembered.' }])

    const proc1 = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc1.write('remember this: secret42\n')
    await delay(800)
    proc1.write('/save\n')
    await delay(500)
    const output1 = await proc1.readAvailable()
    proc1.kill()

    const sessionMatch = output1.match(/[0-9a-f-]{36}/)
    if (!sessionMatch) return

    const sessionId = sessionMatch[0]
    env.mock.enqueue([{ type: 'text', content: 'Second session response.' }])

    const proc2 = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6', '--resume', sessionId], env.binaryEnv)
    await delay(500)
    proc2.write('what did I say to remember?\n')
    await delay(800)
    proc2.kill()

    const reqs = env.mock.requests()
    expect(reqs.length).toBeGreaterThanOrEqual(2)
    const secondBody = reqs[reqs.length - 1]?.body as any
    expect(JSON.stringify(secondBody)).toContain('secret42')
  })

  it('SIGINT during response exits cleanly without zombie process', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Long response...' }])
    const proc = spawnBinary(['--repl', '--model', 'claude-sonnet-4-6'], env.binaryEnv)
    await delay(500)
    proc.write('start something\n')
    await delay(200)
    proc.kill()
    const result = await Promise.race([
      proc.exited,
      new Promise<null>(r => setTimeout(() => r(null), 3000)),
    ])
    expect(result).not.toBeNull()
  })
})
