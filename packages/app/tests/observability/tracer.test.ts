import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Tracer, NoopTracer, type Span, type TraceRecord } from '../../src/observability/tracer'
import { captureStdout, captureStderr } from '../fixtures'

describe('Tracer', () => {
  let captured: string[]
  let restore: () => void

  beforeEach(() => {
    ({ captured, restore } = captureStderr())
  })

  afterEach(() => {
    restore()
  })

  it('creates spans with traceId and spanId', () => {
    const tracer = new Tracer({ output: 'stderr' })
    const span = tracer.startSpan('test.op')
    expect(span.traceId).toBe(tracer.getTraceId())
    expect(span.spanId).toBeDefined()
    expect(span.name).toBe('test.op')
    expect(span.status).toBe('ok')
  })

  it('emits trace records on span end (not on start)', () => {
    const tracer = new Tracer({ output: 'stderr' })
    const span = tracer.startSpan('test.op', { foo: 'bar' })
    expect(captured).toHaveLength(0) // No output on start
    tracer.endSpan(span)

    expect(captured).toHaveLength(1) // Only on end
    const record = JSON.parse(captured[0]!.trim()) as TraceRecord
    expect(record.type).toBe('span')
    expect(record.name).toBe('test.op')
    expect(record.durationMs).toBeDefined()
    expect(typeof record.durationMs).toBe('number')
    expect(record.traceId).toBe(tracer.getTraceId())
    expect(record.status).toBe('ok')
  })

  it('tracks parent spans', () => {
    const tracer = new Tracer({ output: 'stderr' })
    const parent = tracer.startSpan('parent')
    const child = tracer.startSpan('child', {}, parent.spanId)
    expect(child.parentSpanId).toBe(parent.spanId)
    tracer.endSpan(child)
    tracer.endSpan(parent)

    const childRecord = JSON.parse(captured[0]!.trim()) as TraceRecord
    expect(childRecord.parentSpanId).toBe(parent.spanId)
    const parentRecord = JSON.parse(captured[1]!.trim()) as TraceRecord
    expect(parentRecord.parentSpanId).toBeUndefined()
  })

  it('records error status', () => {
    const tracer = new Tracer({ output: 'stderr' })
    const span = tracer.startSpan('failing.op')
    tracer.endSpan(span, 'error', { error: 'something broke' })

    const record = JSON.parse(captured[0]!.trim()) as TraceRecord
    expect(record.status).toBe('error')
    expect(record.attributes.error).toBe('something broke')
  })

  it('records span events', () => {
    const tracer = new Tracer({ output: 'stderr' })
    const span = tracer.startSpan('op')
    tracer.addEvent(span, 'checkpoint', { step: 1 })
    tracer.addEvent(span, 'checkpoint', { step: 2 })
    expect(span.events).toHaveLength(2)
    tracer.endSpan(span)

    const record = JSON.parse(captured[0]!.trim()) as TraceRecord
    expect(record.events!.length).toBe(2)
  })

  it('merges attributes on end', () => {
    const tracer = new Tracer({ output: 'stderr' })
    const span = tracer.startSpan('op', { initial: true })
    tracer.endSpan(span, 'ok', { final: true })

    expect(span.attributes).toEqual({ initial: true, final: true })
  })

  it('includes sessionId in trace records', () => {
    const tracer = new Tracer({ output: 'stderr', sessionId: 'sess-123' })
    const span = tracer.startSpan('op')
    tracer.endSpan(span)

    const record = JSON.parse(captured[0]!.trim()) as TraceRecord
    expect(record.attributes.sessionId).toBe('sess-123')
  })

  it('outputs to stdout when configured', () => {
    restore() // restore stderr first
    const output = captureStdout(() => {
      const tracer = new Tracer({ output: 'stdout' })
      const span = tracer.startSpan('op')
      tracer.endSpan(span)
    })
    expect(output.trim().length).toBeGreaterThan(0)
  })
})

describe('NoopTracer', () => {
  it('returns noop spans without output', () => {
    const stderr = captureStderr()
    try {
      const tracer = new NoopTracer()
      const span = tracer.startSpan('test')
      tracer.addEvent(span, 'event')
      tracer.endSpan(span)
      expect(stderr.captured).toHaveLength(0)
    } finally {
      stderr.restore()
    }
  })
})
