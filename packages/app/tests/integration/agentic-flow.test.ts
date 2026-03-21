import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Agentic flow integration', () => {
  let env: TestEnv
  let tmpDir: string

  beforeAll(async () => {
    env = await createTestEnv()
    tmpDir = join(tmpdir(), `ra-agentic-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(async () => { await env.cleanup() })
  afterEach(() => env.mock.resetRequests())

  it('multi-turn tool loop: LLM calls tool twice then gives final answer', async () => {
    env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: { step: 1 } }])
    env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: { step: 2 } }])
    env.mock.enqueue([{ type: 'text', content: 'All steps complete. Final answer: 42.' }])

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--max-iterations', '10', 'do multi-step task'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Final answer: 42.')
    expect(env.mock.requests()).toHaveLength(3)
  })

  it('max iterations stops the loop and exits cleanly', async () => {
    for (let i = 0; i < 20; i++) {
      env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: {} }])
    }
    const { exitCode } = await runBinary(
      ['--cli', '--max-iterations', '3', 'go'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(env.mock.requests().length).toBeLessThanOrEqual(3)
  })

  it('session persistence: second run with --resume receives prior messages', async () => {
    const sessionId = `persist-test-${Date.now()}`
    env.mock.enqueue([{ type: 'text', content: 'I remember you said banana.' }])

    await runBinary(
      ['--cli', `--resume=${sessionId}`, 'remember banana'],
      env.binaryEnv,
    )
    env.mock.resetRequests()

    env.mock.enqueue([{ type: 'text', content: 'You said banana earlier.' }])
    await runBinary(
      ['--cli', `--resume=${sessionId}`, 'what did I say?'],
      env.binaryEnv,
    )

    const secondReq = env.mock.requests()[0]?.body as any
    const messages = secondReq?.messages ?? []
    expect(JSON.stringify(messages)).toContain('banana')
  })

  it('no duplicate messages sent to model on resumed session', async () => {
    const sessionId = `dedup-test-${Date.now()}`

    // Turn 1
    env.mock.enqueue([{ type: 'text', content: 'first response' }])
    await runBinary(
      ['--cli', `--resume=${sessionId}`, 'hello world'],
      env.binaryEnv,
    )
    env.mock.resetRequests()

    // Turn 2 — resume the session
    env.mock.enqueue([{ type: 'text', content: 'second response' }])
    await runBinary(
      ['--cli', `--resume=${sessionId}`, 'follow up'],
      env.binaryEnv,
    )

    const secondReq = env.mock.requests()[0]?.body as Record<string, unknown>
    const messages = (secondReq?.messages ?? []) as { role: string; content: string }[]

    // System prompt must appear at most once
    const systemMessages = messages.filter(m => m.role === 'system')
    expect(systemMessages.length).toBeLessThanOrEqual(1)

    // No two consecutive messages should have identical content (duplicate detection)
    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1]!
      const curr = messages[i]!
      if (prev.role === curr.role && typeof prev.content === 'string' && typeof curr.content === 'string') {
        expect(prev.content).not.toBe(curr.content)
      }
    }

    // The conversation should flow: ...prior messages → user "hello world" → assistant → user "follow up"
    const userMessages = messages.filter(m => m.role === 'user')
    const userTexts = userMessages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
    expect(userTexts.some(t => t.includes('hello world'))).toBe(true)
    expect(userTexts.some(t => t.includes('follow up'))).toBe(true)
  })

  it('middleware hooks fire: beforeLoopBegin is invoked', async () => {
    const hooksFile = join(tmpDir, 'hooks-log.json')
    writeFileSync(hooksFile, '[]')

    const mwFile = join(tmpDir, 'hook-recorder.ts')
    const escapedFile = hooksFile.replace(/\\/g, '/')
    writeFileSync(mwFile, `
import { readFileSync, writeFileSync } from 'fs'
export default async function(_ctx: unknown) {
  try {
    const existing = JSON.parse(readFileSync('${escapedFile}', 'utf8'))
    existing.push('beforeLoopBegin')
    writeFileSync('${escapedFile}', JSON.stringify(existing))
  } catch {}
}
`)

    env.mock.enqueue([{ type: 'text', content: 'done' }])

    const configFile = join(tmpDir, 'ra-mw.config.json')
    writeFileSync(configFile, JSON.stringify({ agent: { middleware: { beforeLoopBegin: [mwFile] } } }))

    const { exitCode } = await runBinary(
      ['--cli', '--config', configFile, 'test middleware'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)

    const logged = JSON.parse(require('fs').readFileSync(hooksFile, 'utf8'))
    expect(logged).toContain('beforeLoopBegin')
  })

  it('context compaction triggers and run completes successfully', async () => {
    // Disable built-in skills, skill dirs, and context files to ensure
    // deterministic message count (system + user = 2 initial messages).
    // Built-in skills inject an available_skills message that changes
    // the compaction zone math and mock response queue consumption order.
    for (let i = 0; i < 2; i++) {
      env.mock.enqueue([{ type: 'tool_call', name: 'noop', args: { data: 'x'.repeat(4000) } }])
    }
    env.mock.enqueue([{ type: 'text', content: 'Summary of prior work.' }])
    env.mock.enqueue([{ type: 'text', content: 'Compaction worked, final answer.' }])

    const configFile = join(tmpDir, 'ra-compact.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        compaction: { enabled: true, maxTokens: 1000, contextWindow: 5000 },
        context: { enabled: false },
      },
      app: { skillDirs: [] },
    }))

    const { stdout, exitCode } = await runBinary(
      ['--cli', '--config', configFile, '--max-iterations', '20', 'start'],
      env.binaryEnv,
    )
    expect(exitCode).toBe(0)
    expect(stdout).toContain('Compaction worked, final answer.')
    const reqs = env.mock.requests()
    expect(reqs.length).toBeGreaterThanOrEqual(4)
    expect(reqs.some(r => (r.body as any)?.stream !== true)).toBe(true)
  })
})
