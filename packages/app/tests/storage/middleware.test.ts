import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { SessionStorage } from '../../src/storage/sessions'
import { createHistoryMiddleware } from '../../src/storage/middleware'
import { createResolverMiddleware } from '../../src/context/resolve-middleware'
import { createSessionMiddleware } from '../../src/agent/session'
import { mergeMiddleware, AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { IProvider, IMessage } from '@chinmaymk/ra'
import type { PatternResolver } from '../../src/context/resolvers'
import { mockProvider, mockSequenceProvider } from '../fixtures'
import { tmpdir } from '../tmpdir'

const TEST_PATH = tmpdir('ra-test-history-mw')

function toolCallProvider(toolName: string, text: string): IProvider {
  let iteration = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('not implemented') },
    async *stream() {
      if (iteration++ === 0) {
        yield { type: 'text' as const, delta: 'thinking...' }
        yield { type: 'tool_call_start' as const, id: 'tc1', name: toolName }
        yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{}' }
        yield { type: 'tool_call_end' as const, id: 'tc1' }
        yield { type: 'done' as const }
      } else {
        yield { type: 'text' as const, delta: text }
        yield { type: 'done' as const }
      }
    },
  }
}

describe('SessionHistoryMiddleware', () => {
  let storage: SessionStorage

  beforeEach(async () => {
    storage = new SessionStorage(TEST_PATH)
    await storage.init()
  })
  afterEach(async () => { await Bun.$`rm -rf ${TEST_PATH}`.quiet() })

  it('persists messages in real time during loop iterations', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    const loop = new AgentLoop({
      provider: mockProvider('hello world'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: createHistoryMiddleware(storage),
    })

    const messages: IMessage[] = [{ role: 'user', content: 'hi' }]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // User message + assistant response
    expect(stored.length).toBe(2)
    expect(stored.some(m => m.role === 'user')).toBe(true)
    expect(stored.some(m => m.role === 'assistant')).toBe(true)
  })

  it('persists tool call results alongside assistant messages', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })
    const tools = new ToolRegistry()
    tools.register({
      name: 'echo',
      description: 'echoes input',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => 'echoed',
    })

    const loop = new AgentLoop({
      provider: toolCallProvider('echo', 'final answer'),
      tools,
      model: 'test',
      sessionId: session.id,
      middleware: createHistoryMiddleware(storage),
    })

    const messages: IMessage[] = [{ role: 'user', content: 'run echo' }]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // user, assistant (with tool call), tool result, assistant (final)
    expect(stored.length).toBe(4)
    expect(stored[0]?.role).toBe('user')
    expect(stored[1]?.role).toBe('assistant')
    expect(stored[2]?.role).toBe('tool')
    expect(stored[3]?.role).toBe('assistant')
  })

  it('captures messages after context compaction shrinks the array', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    // Provider that yields 2 iterations: tool call then final answer
    let iteration = 0
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('not implemented') },
      async *stream(request) {
        if (iteration++ === 0) {
          yield { type: 'text' as const, delta: 'calling tool' }
          yield { type: 'tool_call_start' as const, id: 'tc1', name: 'noop' }
          yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{}' }
          yield { type: 'tool_call_end' as const, id: 'tc1' }
          yield { type: 'done' as const }
        } else {
          yield { type: 'text' as const, delta: 'post-compaction answer' }
          yield { type: 'done' as const }
        }
      },
    }

    const tools = new ToolRegistry()
    tools.register({
      name: 'noop',
      description: 'does nothing',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => 'ok',
    })

    // Simulate compaction via a beforeModelCall middleware that shrinks the
    // messages array on the second iteration (after the first response + tool result)
    let modelCallCount = 0
    const fakeCompaction = async (ctx: any) => {
      modelCallCount++
      if (modelCallCount === 2) {
        // Simulate compaction: keep only a summary
        const msgs = ctx.request.messages
        msgs.length = 0
        msgs.push({ role: 'system', content: '[compacted summary]' })
      }
    }

    const middleware = mergeMiddleware(
      { beforeModelCall: [fakeCompaction] },
      createHistoryMiddleware(storage),
    )

    const loop = new AgentLoop({
      provider,
      tools,
      model: 'test',
      sessionId: session.id,
      middleware,
    })

    const messages: IMessage[] = [{ role: 'user', content: 'hi' }]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // user, assistant (tool call), tool result, compacted summary, post-compaction assistant
    expect(stored.length).toBe(5)
    expect(stored[0]?.role).toBe('user')
    expect(stored[1]?.role).toBe('assistant')
    expect(stored[2]?.role).toBe('tool')
    expect(stored[3]?.role).toBe('system')
    expect(stored[3]?.content).toBe('[compacted summary]')
    expect(stored[4]?.role).toBe('assistant')
    expect(stored[4]?.content).toBe('post-compaction answer')
  })

  it('writes logs and traces to the session directory via createSessionMiddleware', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    const { middleware, logger } = createSessionMiddleware(undefined, {
      storage,
      sessionId: session.id,
      logsEnabled: true,
      logLevel: 'info',
      tracesEnabled: true,
    })

    const loop = new AgentLoop({
      provider: mockProvider('hello'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware,
      logger,
    })

    await loop.run([{ role: 'user', content: 'hi' }])

    // Verify logs.jsonl exists in the session directory
    const sessionDir = storage.sessionDir(session.id)
    const logsFile = Bun.file(join(sessionDir, 'logs.jsonl'))
    expect(await logsFile.exists()).toBe(true)

    const logsContent = await logsFile.text()
    const logLines = logsContent.trim().split('\n').map(l => JSON.parse(l))
    expect(logLines.some((e: any) => e.message === 'agent loop starting')).toBe(true)
    expect(logLines.some((e: any) => e.message === 'agent loop complete')).toBe(true)
    expect(logLines.every((e: any) => e.sessionId === session.id)).toBe(true)

    // Verify traces.jsonl exists in the session directory
    const tracesFile = Bun.file(join(sessionDir, 'traces.jsonl'))
    expect(await tracesFile.exists()).toBe(true)

    const tracesContent = await tracesFile.text()
    const traceLines = tracesContent.trim().split('\n').map(l => JSON.parse(l))
    expect(traceLines.some((e: any) => e.name === 'agent.loop')).toBe(true)
    expect(traceLines.some((e: any) => e.name === 'agent.model_call')).toBe(true)

    // Verify messages.jsonl is also written (session history still works)
    const stored = await storage.readMessages(session.id)
    expect(stored.length).toBeGreaterThan(0)
  })

  it('stores prefix messages when priorCount is 0 (new session)', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    // priorCount=0 means nothing is on disk yet — everything should be saved
    const loop = new AgentLoop({
      provider: mockProvider('response'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: createHistoryMiddleware(storage, 0),
    })

    const messages: IMessage[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'context info' },
      { role: 'user', content: 'hello' },
    ]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // All initial messages + assistant response
    expect(stored).toHaveLength(4)
    expect(stored[0]?.role).toBe('system')
    expect(stored[0]?.content).toBe('you are helpful')
    expect(stored[1]?.role).toBe('user')
    expect(stored[1]?.content).toBe('context info')
    expect(stored[2]?.role).toBe('user')
    expect(stored[2]?.content).toBe('hello')
    expect(stored[3]?.role).toBe('assistant')
  })

  it('does not re-store prefix when resuming (priorCount = stored count)', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    // Simulate first turn storing prefix + user + assistant
    await storage.appendMessages(session.id, [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ])

    // Second turn: priorCount=3 (everything on disk), only new user message saved
    const loop = new AgentLoop({
      provider: mockProvider('second response'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: createHistoryMiddleware(storage, 3),
    })

    const messages: IMessage[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'follow up' },
    ]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // Original 3 + new user + new assistant
    expect(stored).toHaveLength(5)
    expect(stored[0]?.content).toBe('you are helpful')
    expect(stored[3]?.role).toBe('user')
    expect(stored[3]?.content).toBe('follow up')
    expect(stored[4]?.role).toBe('assistant')
  })

  it('does not duplicate messages when middleware replaces objects via spread', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    // Middleware that replaces the system message object (simulating resolver spread)
    let modelCallCount = 0
    const replacer = async (ctx: any) => {
      modelCallCount++
      if (modelCallCount === 1) {
        const msgs = ctx.request.messages
        const sys = msgs[0]
        if (sys?.role === 'system') {
          // Replace with a NEW object (spread) — simulates resolver middleware.
          // The _messageId should be copied, preventing duplicate storage.
          msgs[0] = { ...sys, content: sys.content + '\n[resolved]' }
        }
      }
    }

    const middleware = mergeMiddleware(
      { beforeModelCall: [replacer] },
      createHistoryMiddleware(storage, 0),
    )

    const loop = new AgentLoop({
      provider: mockProvider('response'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware,
    })

    const messages: IMessage[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'hello' },
    ]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // system + user + assistant = 3. NOT 4 (which would mean duplicate system message).
    expect(stored).toHaveLength(3)
    expect(stored[0]?.role).toBe('system')
    expect(stored[1]?.role).toBe('user')
    expect(stored[2]?.role).toBe('assistant')

    // Verify only one system message was stored
    const systemMessages = stored.filter(m => m.role === 'system')
    expect(systemMessages).toHaveLength(1)
  })

  it('resolver middleware + history: skill pattern in system prompt does not duplicate', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    // Fake skill resolver: /verify → <skill name="verify">run tests</skill>
    const skillResolver: PatternResolver = {
      name: 'skill',
      pattern: /(?<=^|\s)\/([\w][\w-]*)(?=\s|$)/gm,
      async resolve(ref: string) {
        if (ref === 'verify') return '<skill name="verify">run tests</skill>'
        return null
      },
    }

    const resolverMw = createResolverMiddleware([skillResolver], '/tmp')
    const historyMw = createHistoryMiddleware(storage, 0)

    const middleware = mergeMiddleware(
      { beforeModelCall: [resolverMw] },
      historyMw,
    )

    const loop = new AgentLoop({
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware,
    })

    // System prompt contains a skill reference that the resolver will expand.
    // The resolver creates a NEW object via spread — _messageId must survive.
    const messages: IMessage[] = [
      { role: 'system', content: 'You are helpful. Use /verify before finishing.' },
      { role: 'user', content: 'available skills: verify' },
      { role: 'user', content: 'do the task' },
    ]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)

    // Exactly: system + 2 users + assistant = 4. NOT 5 (duplicated system).
    expect(stored).toHaveLength(4)
    expect(stored[0]?.role).toBe('system')
    expect(stored[1]?.role).toBe('user')
    expect(stored[2]?.role).toBe('user')
    expect(stored[3]?.role).toBe('assistant')

    // System message stored exactly once
    expect(stored.filter(m => m.role === 'system')).toHaveLength(1)

    // The stored system message should be the ORIGINAL (not yet resolved),
    // because resolution happens in beforeModelCall which fires after
    // beforeLoopBegin where history saves initial messages.
    expect((stored[0]!.content as string)).toContain('/verify')
  })

  it('resolver middleware + history: no duplicates across resumed multi-turn session', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    // Fake file resolver: @config → "[config]\nkey=value"
    const fileResolver: PatternResolver = {
      name: 'file',
      pattern: /(?<!\w)@(\w+)/g,
      async resolve(ref: string) {
        return `[${ref}]\nkey=value`
      },
    }

    const resolverMw = createResolverMiddleware([fileResolver], '/tmp')

    // ── Turn 1: new session ──
    const turn1History = createHistoryMiddleware(storage, 0)
    const turn1Mw = mergeMiddleware({ beforeModelCall: [resolverMw] }, turn1History)

    const turn1Loop = new AgentLoop({
      provider: mockProvider('first answer'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: turn1Mw,
    })

    const turn1Messages: IMessage[] = [
      { role: 'system', content: 'You are helpful. See @config for settings.' },
      { role: 'user', content: 'check @readme' },
    ]
    await turn1Loop.run(turn1Messages)

    const afterTurn1 = await storage.readMessages(session.id)
    // system + user + assistant = 3
    expect(afterTurn1).toHaveLength(3)
    expect(afterTurn1[0]?.role).toBe('system')
    expect(afterTurn1[1]?.role).toBe('user')
    expect(afterTurn1[2]?.role).toBe('assistant')

    // ── Turn 2: resume ──
    // Load stored messages, append new user message (simulating CLI resume)
    const storedMessages = await storage.readMessages(session.id)
    const priorCount = storedMessages.length

    const turn2History = createHistoryMiddleware(storage, priorCount)
    const turn2Mw = mergeMiddleware({ beforeModelCall: [resolverMw] }, turn2History)

    const turn2Loop = new AgentLoop({
      provider: mockProvider('second answer'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: turn2Mw,
    })

    const turn2Messages: IMessage[] = [
      ...storedMessages,
      { role: 'user', content: 'now look at @changelog' },
    ]
    await turn2Loop.run(turn2Messages)

    const afterTurn2 = await storage.readMessages(session.id)

    // Turn 1 (3) + new user + new assistant = 5. No duplicates.
    expect(afterTurn2).toHaveLength(5)

    // Verify each message appears exactly once by content
    expect(afterTurn2.filter(m => m.role === 'system')).toHaveLength(1)
    expect(afterTurn2.filter(m => m.role === 'user' && (m.content as string).includes('@readme'))).toHaveLength(1)
    expect(afterTurn2.filter(m => m.role === 'assistant' && m.content === 'first answer')).toHaveLength(1)
    expect(afterTurn2.filter(m => m.role === 'user' && (m.content as string).includes('@changelog'))).toHaveLength(1)
    expect(afterTurn2.filter(m => m.role === 'assistant' && m.content === 'second answer')).toHaveLength(1)

    // Verify _messageId is present and unique across all stored messages
    const ids = afterTurn2.map(m => m._messageId).filter(Boolean)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
  })

  it('skips initial messages with priorCount and saves new ones', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    // priorCount=2 means first 2 messages are already on disk
    const loop = new AgentLoop({
      provider: mockProvider('response'),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: createHistoryMiddleware(storage, 2),
    })

    const messages: IMessage[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'context info' },
      { role: 'user', content: 'hello' },  // new — should be saved
    ]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // New user message + assistant response
    expect(stored).toHaveLength(2)
    expect(stored[0]?.role).toBe('user')
    expect(stored[0]?.content).toBe('hello')
    expect(stored[1]?.role).toBe('assistant')
  })
})
