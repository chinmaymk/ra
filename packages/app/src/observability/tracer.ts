import { randomUUID } from 'crypto'
import { JsonlWriter } from './writer'

export interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTime: number
  endTime?: number
  durationMs?: number
  attributes: Record<string, unknown>
  status: 'ok' | 'error'
  events: SpanEvent[]
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

export interface TraceRecord {
  type: 'span'
  timestamp: string
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  durationMs: number
  status: 'ok' | 'error'
  attributes: Record<string, unknown>
  events?: SpanEvent[]
}

export interface TracerOptions {
  output: 'stderr' | 'stdout' | 'file'
  filePath?: string
  sessionId?: string
}

export class Tracer {
  private traceId: string
  private sessionId: string | undefined
  private writer: JsonlWriter
  private activeSpans: Map<string, Span> = new Map()

  constructor(options: TracerOptions | null, traceId?: string) {
    this.traceId = traceId ?? randomUUID()
    this.sessionId = options?.sessionId
    this.writer = new JsonlWriter(options?.output ?? 'stderr', options?.filePath)
  }

  getTraceId(): string { return this.traceId }
  setSessionId(sessionId: string): void { this.sessionId = sessionId }

  startSpan(name: string, attributes?: Record<string, unknown>, parentSpanId?: string): Span {
    const span: Span = {
      traceId: this.traceId,
      spanId: randomUUID(),
      ...(parentSpanId && { parentSpanId }),
      name,
      startTime: performance.now(),
      attributes: attributes ?? {},
      status: 'ok',
      events: [],
    }
    this.activeSpans.set(span.spanId, span)
    return span
  }

  addEvent(span: Span, name: string, attributes?: Record<string, unknown>): void {
    span.events.push({ name, timestamp: performance.now(), attributes })
  }

  endSpan(span: Span, status?: 'ok' | 'error', attributes?: Record<string, unknown>): void {
    const endTime = performance.now()
    span.endTime = endTime
    const durationMs = Math.round((endTime - span.startTime) * 100) / 100
    span.durationMs = durationMs
    if (status) span.status = status
    if (attributes) Object.assign(span.attributes, attributes)
    this.activeSpans.delete(span.spanId)

    this.writer.write({
      type: 'span',
      timestamp: new Date().toISOString(),
      traceId: span.traceId,
      spanId: span.spanId,
      ...(span.parentSpanId && { parentSpanId: span.parentSpanId }),
      name: span.name,
      durationMs,
      status: span.status,
      attributes: { ...(this.sessionId && { sessionId: this.sessionId }), ...span.attributes },
      ...(span.events.length > 0 && { events: span.events }),
    } satisfies TraceRecord)
  }

  async flush(): Promise<void> { await this.writer.flush() }
}

/** A no-op tracer that silently discards all spans. */
export class NoopTracer extends Tracer {
  constructor() { super(null, 'noop') }

  private static NOOP_SPAN: Span = {
    traceId: 'noop', spanId: 'noop', name: 'noop',
    startTime: 0, attributes: {}, status: 'ok', events: [],
  }

  override startSpan(_name: string, _attributes?: Record<string, unknown>, _parentSpanId?: string): Span { return NoopTracer.NOOP_SPAN }
  override addEvent(_span: Span, _name: string, _attributes?: Record<string, unknown>): void {}
  override endSpan(_span: Span, _status?: 'ok' | 'error', _attributes?: Record<string, unknown>): void {}
  override async flush(): Promise<void> {}
}
