import { randomUUID } from 'crypto'
import { OutputWriter } from './output-writer'

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
  private writer: OutputWriter
  private sessionId: string | undefined
  private activeSpans: Map<string, Span> = new Map()

  constructor(options: TracerOptions | null, traceId?: string) {
    this.traceId = traceId ?? randomUUID()
    this.writer = new OutputWriter(options?.output ?? 'stderr', options?.filePath)
    this.sessionId = options?.sessionId
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
    span.endTime = performance.now()
    span.durationMs = Math.round((span.endTime! - span.startTime) * 100) / 100
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
      durationMs: span.durationMs!,
      status: span.status,
      attributes: {
        ...(this.sessionId && { sessionId: this.sessionId }),
        ...span.attributes,
      },
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
