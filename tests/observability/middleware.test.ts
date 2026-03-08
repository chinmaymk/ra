import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createObservabilityMiddleware } from '../../src/observability/middleware'
import { Logger } from '../../src/observability/logger'
import { Tracer } from '../../src/observability/tracer'
import { AgentLoop } from '../../src/agent/loop'
import { ToolRegistry } from '../../src/agent/tool-registry'
import type { IProvider, StreamChunk } from '../../src/providers/types'

function mockProvider(responses: StreamChunk[][]): IProvider {
  let callIndex = 0
  return {
    name: 'mock',
    chat: async () => { throw new Error('use stream') },
    async *stream() {
      const chunks = responses[callIndex++] ?? [{ type: 'text' as const, delta: 'done' }, { type: 'done' as const }]
      for (const chunk of chunks) yield chunk
    },
  }
}

describe('observability middleware', () => {
  let captured: string[]
  let originalWrite: typeof process.stderr.write

  beforeEach(() => {
    captured = []
    originalWrite = process.stderr.write
    process.stderr.write = ((data: string) => {
      captured.push(data)
      return true
    }) as typeof process.stderr.write
  })

  afterEach(() => {
    process.stderr.write = originalWrite
  })

  it('emits logs and traces for a simple loop via middleware hooks', async () => {
    const logger = new Logger({ level: 'debug', output: 'stderr' })
    const tracer = new Tracer({ output: 'stderr' })
    const obsMw = createObservabilityMiddleware(logger, tracer)

    const provider = mockProvider([
      [
        { type: 'text', delta: 'hello' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
    ])

    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      maxIterations: 10,
      middleware: obsMw,
    })

    await loop.run([{ role: 'user', content: 'hi' }])

    const logs = captured
      .map(line => { try { return JSON.parse(line.trim()) } catch { return null } })
      .filter(Boolean)

    const logEntries = logs.filter((e: Record<string, unknown>) => e.level)
    const traceRecords = logs.filter((e: Record<string, unknown>) => e.type === 'span')

    // Should have logs for: loop start, iteration start (debug), model response, iteration complete (debug), loop complete
    expect(logEntries.length).toBeGreaterThanOrEqual(3)
    expect(logEntries.some((e: Record<string, unknown>) => e.message === 'agent loop starting')).toBe(true)
    expect(logEntries.some((e: Record<string, unknown>) => e.message === 'model responded')).toBe(true)
    expect(logEntries.some((e: Record<string, unknown>) => e.message === 'agent loop complete')).toBe(true)

    // Should have trace spans: agent.loop, agent.iteration, agent.model_call
    expect(traceRecords.length).toBe(3)
    expect(traceRecords.some((r: Record<string, unknown>) => r.name === 'agent.loop')).toBe(true)
    expect(traceRecords.some((r: Record<string, unknown>) => r.name === 'agent.iteration')).toBe(true)
    expect(traceRecords.some((r: Record<string, unknown>) => r.name === 'agent.model_call')).toBe(true)
  })

  it('logs tool execution via middleware hooks', async () => {
    const logger = new Logger({ level: 'info', output: 'stderr' })
    const tracer = new Tracer({ output: 'stderr' })
    const obsMw = createObservabilityMiddleware(logger, tracer)

    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'echo' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{"text":"hi"}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
      [
        { type: 'text', delta: 'echoed' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({ name: 'echo', description: 'echo', inputSchema: {}, execute: async (input: any) => input.text })

    const loop = new AgentLoop({
      provider,
      tools,
      maxIterations: 10,
      middleware: obsMw,
    })

    await loop.run([{ role: 'user', content: 'echo hi' }])

    const logs = captured
      .map(line => { try { return JSON.parse(line.trim()) } catch { return null } })
      .filter(Boolean)

    const logEntries = logs.filter((e: Record<string, unknown>) => e.level)

    expect(logEntries.some((e: Record<string, unknown>) => e.message === 'executing tool' && e.tool === 'echo')).toBe(true)
    expect(logEntries.some((e: Record<string, unknown>) => e.message === 'tool execution complete' && e.tool === 'echo')).toBe(true)
  })

  it('does not touch the loop when using noop logger/tracer', async () => {
    const { NoopLogger } = await import('../../src/observability/logger')
    const { NoopTracer } = await import('../../src/observability/tracer')
    const obsMw = createObservabilityMiddleware(new NoopLogger(), new NoopTracer())

    const provider = mockProvider([[{ type: 'text', delta: 'ok' }, { type: 'done' }]])
    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      maxIterations: 10,
      middleware: obsMw,
    })

    await loop.run([{ role: 'user', content: 'test' }])
    // No output captured
    expect(captured).toHaveLength(0)
  })
})
