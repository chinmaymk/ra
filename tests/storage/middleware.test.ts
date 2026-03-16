import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { SessionStorage } from '../../src/storage/sessions'
import { createSessionHistoryMiddleware } from '../../src/storage/middleware'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { IProvider, IMessage } from '../../src/providers/types'
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
    const mw = createSessionHistoryMiddleware({ storage })

    const loop = new AgentLoop({
      provider: mockProvider(['hello world']),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: {
        beforeLoopBegin: [mw.beforeLoopBegin],
        afterLoopIteration: [mw.afterLoopIteration],
      },
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
    const mw = createSessionHistoryMiddleware({ storage })
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
      middleware: {
        beforeLoopBegin: [mw.beforeLoopBegin],
        afterLoopIteration: [mw.afterLoopIteration],
      },
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

  it('does not persist initial messages (only loop-generated)', async () => {
    const session = await storage.create({ provider: 'mock', model: 'test', interface: 'cli' })
    const mw = createSessionHistoryMiddleware({ storage })

    const loop = new AgentLoop({
      provider: mockProvider(['response']),
      tools: new ToolRegistry(),
      model: 'test',
      sessionId: session.id,
      middleware: {
        beforeLoopBegin: [mw.beforeLoopBegin],
        afterLoopIteration: [mw.afterLoopIteration],
      },
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
