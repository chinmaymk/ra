import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { createObservabilityMiddleware } from '../../src/observability/middleware'
import { Logger } from '../../src/observability/logger'
import { Tracer } from '../../src/observability/tracer'
import { AgentLoop, ToolRegistry } from '@chinmaymk/ra'
import type { IProvider, StreamChunk } from '@chinmaymk/ra'

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

function throwingProvider(error: Error): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw error },
    async *stream() { throw error },
  }
}

function parseOutput(captured: string[]) {
  const all = captured
    .map(line => { try { return JSON.parse(line.trim()) } catch { return null } })
    .filter(Boolean) as Record<string, unknown>[]
  return {
    logs: all.filter(e => e.level),
    spans: all.filter(e => e.type === 'span'),
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

    const { logs, spans } = parseOutput(captured)

    // Should have logs for: loop start, iteration start (debug), model response, iteration complete (debug), loop complete
    expect(logs.length).toBeGreaterThanOrEqual(3)
    expect(logs.some(e => e.message === 'agent loop starting')).toBe(true)
    expect(logs.some(e => e.message === 'model responded')).toBe(true)
    expect(logs.some(e => e.message === 'agent loop complete')).toBe(true)

    // Should have trace spans: agent.loop, agent.iteration, agent.model_call
    expect(spans.length).toBe(3)
    expect(spans.some(r => r.name === 'agent.loop')).toBe(true)
    expect(spans.some(r => r.name === 'agent.iteration')).toBe(true)
    expect(spans.some(r => r.name === 'agent.model_call')).toBe(true)
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

    const { logs, spans } = parseOutput(captured)

    expect(logs.some(e => e.message === 'executing tool' && e.tool === 'echo')).toBe(true)
    expect(logs.some(e => e.message === 'tool execution complete' && e.tool === 'echo')).toBe(true)

    // Tool execution span should be emitted
    expect(spans.some(r => r.name === 'agent.tool_execution')).toBe(true)
    const toolSpan = spans.find(r => r.name === 'agent.tool_execution')
    expect(toolSpan!.status).toBe('ok')
  })

  it('logs tool execution failure with error span', async () => {
    const logger = new Logger({ level: 'info', output: 'stderr' })
    const tracer = new Tracer({ output: 'stderr' })
    const obsMw = createObservabilityMiddleware(logger, tracer)

    const provider = mockProvider([
      [
        { type: 'tool_call_start', id: 'tc1', name: 'fail_tool' },
        { type: 'tool_call_delta', id: 'tc1', argsDelta: '{}' },
        { type: 'tool_call_end', id: 'tc1' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
      [
        { type: 'text', delta: 'recovered' },
        { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
      ],
    ])

    const tools = new ToolRegistry()
    tools.register({ name: 'fail_tool', description: 'fails', inputSchema: {}, execute: async () => { throw new Error('disk full') } })

    const loop = new AgentLoop({ provider, tools, maxIterations: 10, middleware: obsMw })
    await loop.run([{ role: 'user', content: 'do it' }])

    const { logs, spans } = parseOutput(captured)

    // Should log error for tool failure
    const errorLog = logs.find(e => e.message === 'tool execution failed')
    expect(errorLog).toBeDefined()
    expect(errorLog!.tool).toBe('fail_tool')
    expect(errorLog!.error).toContain('disk full')

    // Tool span should be emitted with error status
    const toolSpan = spans.find(r => r.name === 'agent.tool_execution')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.status).toBe('error')
  })

  it('does not touch the loop when using noop logger/tracer', async () => {
    const { NoopLogger } = await import('@chinmaymk/ra')
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

  it('ends all child spans on error and includes stack trace', async () => {
    const logger = new Logger({ level: 'info', output: 'stderr' })
    const tracer = new Tracer({ output: 'stderr' })
    const obsMw = createObservabilityMiddleware(logger, tracer)

    const boom = new Error('provider exploded')
    const provider = throwingProvider(boom)

    const loop = new AgentLoop({
      provider,
      tools: new ToolRegistry(),
      maxIterations: 10,
      middleware: obsMw,
    })

    await expect(loop.run([{ role: 'user', content: 'hi' }])).rejects.toThrow('provider exploded')

    const { logs, spans } = parseOutput(captured)

    // Error log should include stack trace
    const errorLog = logs.find(e => e.message === 'agent loop failed')
    expect(errorLog).toBeDefined()
    expect(errorLog!.stack).toContain('provider exploded')
    expect(errorLog!.phase).toBe('stream')

    // All opened spans should be closed (model_call, iteration, loop)
    // model_call and iteration are opened in beforeModelCall, then drained in onError
    const modelSpan = spans.find(r => r.name === 'agent.model_call')
    const iterSpan = spans.find(r => r.name === 'agent.iteration')
    const loopSpan = spans.find(r => r.name === 'agent.loop')

    expect(modelSpan).toBeDefined()
    expect(modelSpan!.status).toBe('error')
    expect(iterSpan).toBeDefined()
    expect(iterSpan!.status).toBe('error')
    expect(loopSpan).toBeDefined()
    expect(loopSpan!.status).toBe('error')

    // Loop span should include stack in attributes
    expect((loopSpan!.attributes as Record<string, unknown>).stack).toContain('provider exploded')
  })

  it('is safe to reuse across multiple loop runs', async () => {
    const logger = new Logger({ level: 'info', output: 'stderr' })
    const tracer = new Tracer({ output: 'stderr' })
    const obsMw = createObservabilityMiddleware(logger, tracer)

    // Run 1: succeeds
    const provider1 = mockProvider([
      [{ type: 'text', delta: 'ok' }, { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } }],
    ])
    const loop1 = new AgentLoop({ provider: provider1, tools: new ToolRegistry(), maxIterations: 10, middleware: obsMw })
    await loop1.run([{ role: 'user', content: 'run1' }])

    captured.length = 0

    // Run 2: succeeds with same middleware
    const provider2 = mockProvider([
      [{ type: 'text', delta: 'ok' }, { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } }],
    ])
    const loop2 = new AgentLoop({ provider: provider2, tools: new ToolRegistry(), maxIterations: 10, middleware: obsMw })
    await loop2.run([{ role: 'user', content: 'run2' }])

    const { logs, spans } = parseOutput(captured)

    // Second run should have its own complete set of spans
    expect(spans.filter(r => r.name === 'agent.loop')).toHaveLength(1)
    expect(spans.filter(r => r.name === 'agent.iteration')).toHaveLength(1)
    expect(spans.filter(r => r.name === 'agent.model_call')).toHaveLength(1)

    // All spans should be ok (no error leakage from previous run)
    expect(spans.every(r => r.status === 'ok')).toBe(true)
  })

  it('is safe to reuse after a failed run', async () => {
    const logger = new Logger({ level: 'info', output: 'stderr' })
    const tracer = new Tracer({ output: 'stderr' })
    const obsMw = createObservabilityMiddleware(logger, tracer)

    // Run 1: fails
    const badProvider = throwingProvider(new Error('crash'))
    const loop1 = new AgentLoop({ provider: badProvider, tools: new ToolRegistry(), maxIterations: 10, middleware: obsMw })
    await loop1.run([{ role: 'user', content: 'run1' }]).catch(() => {})

    captured.length = 0

    // Run 2: succeeds with same middleware
    const goodProvider = mockProvider([
      [{ type: 'text', delta: 'ok' }, { type: 'done', usage: { inputTokens: 5, outputTokens: 3 } }],
    ])
    const loop2 = new AgentLoop({ provider: goodProvider, tools: new ToolRegistry(), maxIterations: 10, middleware: obsMw })
    await loop2.run([{ role: 'user', content: 'run2' }])

    const { spans } = parseOutput(captured)

    // Second run should produce clean spans with no error status leakage
    expect(spans.filter(r => r.name === 'agent.loop')).toHaveLength(1)
    expect(spans.find(r => r.name === 'agent.loop')!.status).toBe('ok')
  })
})
