import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { runBinary } from './helpers/binary'
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'fs'
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

    // Anthropic provider extracts system → system param, rest → messages array
    const secondReq = env.mock.requests()[0]?.body as Record<string, unknown>
    const messages = (secondReq?.messages ?? []) as { role: string; content: unknown; _messageId?: string }[]
    const system = secondReq?.system

    // System param must be set (extracted from system message)
    expect(system).toBeDefined()

    // No system messages in the messages array (they are extracted to system param)
    expect(messages.filter(m => m.role === 'system')).toHaveLength(0)

    // _messageId must NOT leak to the provider request
    for (const msg of messages) {
      expect(msg._messageId).toBeUndefined()
    }

    // Anthropic mergeConsecutiveRoles may merge adjacent user messages from
    // context injection, so check assistant count to verify no duplication
    expect(messages.filter(m => m.role === 'assistant')).toHaveLength(1)

    // Both user messages must appear exactly once in the conversation
    const allContent = JSON.stringify(messages)
    expect(allContent).toContain('hello world')
    expect(allContent).toContain('follow up')

    // No role appears more than expected: find duplicate content
    const contentSet = new Set<string>()
    for (const msg of messages) {
      const key = `${msg.role}:${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`
      expect(contentSet.has(key)).toBe(false)
      contentSet.add(key)
    }
  })

  it('session history is not written twice across turns', async () => {
    const sessionId = `history-dedup-${Date.now()}`

    // Turn 1: user → assistant
    env.mock.enqueue([{ type: 'text', content: 'turn one reply' }])
    await runBinary(
      ['--cli', `--resume=${sessionId}`, 'first message'],
      env.binaryEnv,
    )

    // Read stored messages after turn 1
    const sessionsDir = join(env.storageDir, 'sessions')
    const sessionDirs = readdirSync(sessionsDir).filter(d => d.includes(sessionId.replace(/[^a-zA-Z0-9_-]/g, '')))
    expect(sessionDirs).toHaveLength(1)
    const messagesFile = join(sessionsDir, sessionDirs[0]!, 'messages.jsonl')
    const afterTurn1 = readFileSync(messagesFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))

    // Turn 1 should have stored: user + assistant (system/context may vary)
    const turn1User = afterTurn1.filter((m: any) => m.role === 'user' && m.content === 'first message')
    const turn1Asst = afterTurn1.filter((m: any) => m.role === 'assistant' && m.content === 'turn one reply')
    expect(turn1User).toHaveLength(1)
    expect(turn1Asst).toHaveLength(1)

    // Turn 2: resume, add second user message
    env.mock.enqueue([{ type: 'text', content: 'turn two reply' }])
    await runBinary(
      ['--cli', `--resume=${sessionId}`, 'second message'],
      env.binaryEnv,
    )

    // Read stored messages after turn 2
    const afterTurn2 = readFileSync(messagesFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))

    // Turn 1 messages must not be duplicated — count each unique message
    const allUser1 = afterTurn2.filter((m: any) => m.role === 'user' && m.content === 'first message')
    const allAsst1 = afterTurn2.filter((m: any) => m.role === 'assistant' && m.content === 'turn one reply')
    const allUser2 = afterTurn2.filter((m: any) => m.role === 'user' && m.content === 'second message')
    const allAsst2 = afterTurn2.filter((m: any) => m.role === 'assistant' && m.content === 'turn two reply')

    expect(allUser1).toHaveLength(1)
    expect(allAsst1).toHaveLength(1)
    expect(allUser2).toHaveLength(1)
    expect(allAsst2).toHaveLength(1)

    // Total messages on disk should be turn1 count + 2 new (user + assistant)
    expect(afterTurn2.length).toBe(afterTurn1.length + 2)
  })

  it('resolver with skill pattern: no duplicates on resume', async () => {
    const sessionId = `skill-resolve-${Date.now()}`

    // Create a skill directory with a SKILL.md file
    const skillsDir = join(tmpDir, 'skills-resolve')
    const skillDir = join(skillsDir, 'check')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      'name: check',
      'description: Run checks',
      '---',
      'Run all checks before finishing.',
    ].join('\n'))

    // Config: custom system prompt with /check skill reference, plus skill dir
    const configFile = join(tmpDir, 'ra-skill-resolve.config.json')
    writeFileSync(configFile, JSON.stringify({
      agent: {
        systemPrompt: 'You are helpful. Always /check before responding.',
        context: { enabled: false },
        skillDirs: [skillsDir],
      },
    }))

    // Turn 1: system prompt gets resolved by resolver middleware (spread replaces object)
    env.mock.enqueue([{ type: 'text', content: 'turn one done' }])
    const { exitCode: exit1 } = await runBinary(
      ['--cli', '--config', configFile, `--resume=${sessionId}`, 'do the task'],
      env.binaryEnv,
    )
    expect(exit1).toBe(0)

    // Verify turn 1 request: system prompt should contain resolved skill XML
    const turn1Req = env.mock.requests()[0]?.body as Record<string, unknown>
    const turn1System = turn1Req?.system
    expect(JSON.stringify(turn1System)).toContain('check')

    // Read stored messages after turn 1
    const sessionsDir = join(env.storageDir, 'sessions')
    const sessionDirs = readdirSync(sessionsDir).filter(d =>
      d.includes(sessionId.replace(/[^a-zA-Z0-9_-]/g, ''))
    )
    expect(sessionDirs).toHaveLength(1)
    const messagesFile = join(sessionsDir, sessionDirs[0]!, 'messages.jsonl')
    const afterTurn1 = readFileSync(messagesFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    const turn1SystemCount = afterTurn1.filter((m: any) => m.role === 'system').length

    // System message must appear exactly once
    expect(turn1SystemCount).toBe(1)

    env.mock.resetRequests()

    // Turn 2: resume session — system prompt loaded from disk,
    // resolver may re-resolve it (creating new object via spread).
    // _messageId must prevent the history middleware from re-saving it.
    env.mock.enqueue([{ type: 'text', content: 'turn two done' }])
    const { exitCode: exit2 } = await runBinary(
      ['--cli', '--config', configFile, `--resume=${sessionId}`, 'follow up'],
      env.binaryEnv,
    )
    expect(exit2).toBe(0)

    // Read stored messages after turn 2
    const afterTurn2 = readFileSync(messagesFile, 'utf8').trim().split('\n').map(l => JSON.parse(l))

    // No message duplication: system still appears exactly once
    const turn2SystemCount = afterTurn2.filter((m: any) => m.role === 'system').length
    expect(turn2SystemCount).toBe(1)

    // Turn 1 messages should not be re-saved
    const turn1Assistants = afterTurn2.filter((m: any) => m.role === 'assistant' && m.content === 'turn one done')
    expect(turn1Assistants).toHaveLength(1)

    // Turn 2 added exactly: new user + new assistant
    expect(afterTurn2.length).toBe(afterTurn1.length + 2)

    // Verify the model request for turn 2 also has no duplicate messages
    const turn2Req = env.mock.requests()[0]?.body as Record<string, unknown>
    const turn2Messages = (turn2Req?.messages ?? []) as { role: string; content: unknown; _messageId?: string }[]
    const turn2AssistantMsgs = turn2Messages.filter(m => m.role === 'assistant')
    expect(turn2AssistantMsgs).toHaveLength(1) // only one assistant turn from prior history

    // _messageId must NOT leak to the provider
    for (const msg of turn2Messages) {
      expect(msg._messageId).toBeUndefined()
    }
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
        compaction: { enabled: true, strategy: 'summarize', maxTokens: 1000, contextWindow: 5000 },
        context: { enabled: false },
        skillDirs: [],
      },
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
