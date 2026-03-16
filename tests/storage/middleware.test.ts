import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { join } from 'path'
import { SessionStorage } from '../../src/storage/sessions'
import { withSessionHistory, createLoopMiddleware } from '../../src/storage/middleware'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { IProvider, IMessage } from '../../src/providers/types'
import type { ObservabilityConfig } from '../../src/observability'
import { tmpdir } from '../tmpdir'

const TEST_PATH = tmpdir('ra-test-history-mw')

function mockProvider(responses: string[]): IProvider {
  let call = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('not implemented') },
    async *stream() {
      const text = responses[call++] ?? 'done'
      yield { type: 'text' as const, delta: text }
      yield { type: 'done' as const }
    },
  }
}

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
    const middleware = withSessionHistory(undefined, storage)

    const loop = new AgentLoop({
      provider: mockProvider(['hello world']),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware,
    })

    const messages: IMessage[] = [{ role: 'user', content: 'hi' }]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.some(m => m.role === 'assistant')).toBe(true)
    expect(stored[0]?.content).toBe('hello world')
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
      middleware: withSessionHistory(undefined, storage),
    })

    const messages: IMessage[] = [{ role: 'user', content: 'run echo' }]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // Should have: assistant (with tool call), tool result, assistant (final)
    expect(stored.length).toBe(3)
    expect(stored[0]?.role).toBe('assistant')
    expect(stored[1]?.role).toBe('tool')
    expect(stored[2]?.role).toBe('assistant')
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

    const baseMw = withSessionHistory(undefined, storage)
    const middleware = {
      ...baseMw,
      // Compaction runs BEFORE session history's beforeModelCall
      beforeModelCall: [fakeCompaction, ...(baseMw.beforeModelCall ?? [])],
    }

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
    // Iteration 1: assistant (tool call) + tool result = 2 messages
    // Compaction shrinks array
    // Iteration 2: assistant (final answer) = 1 message
    expect(stored.length).toBe(3)
    expect(stored[0]?.role).toBe('assistant')
    expect(stored[1]?.role).toBe('tool')
    expect(stored[2]?.role).toBe('assistant')
    expect(stored[2]?.content).toBe('post-compaction answer')
  })

  it('writes logs and traces to the session directory via createLoopMiddleware', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    const obsConfig: ObservabilityConfig = {
      enabled: true,
      logs: { enabled: true, level: 'info', output: 'session' },
      traces: { enabled: true, output: 'session' },
    }

    const { middleware, logger } = createLoopMiddleware(undefined, {
      storage,
      sessionId: session.id,
      obsConfig,
    })

    const loop = new AgentLoop({
      provider: mockProvider(['hello']),
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
    expect(stored[0]?.role).toBe('assistant')
  })

  it('does not persist initial messages (only loop-generated)', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })

    const loop = new AgentLoop({
      provider: mockProvider(['response']),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: withSessionHistory(undefined, storage),
    })

    // Pass system + context + user messages as initial
    const messages: IMessage[] = [
      { role: 'system', content: 'you are helpful' },
      { role: 'user', content: 'context info' },
      { role: 'user', content: 'hello' },
    ]
    await loop.run(messages)

    const stored = await storage.readMessages(session.id)
    // Only the assistant response should be stored, not the initial messages
    expect(stored).toHaveLength(1)
    expect(stored[0]?.role).toBe('assistant')
  })
})
