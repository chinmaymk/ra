export { Logger, NoopLogger, type LogLevel, type LogEntry, type LoggerOptions } from './logger'
export { Tracer, NoopTracer, type Span, type SpanEvent, type TraceRecord, type TracerOptions } from './tracer'
export { createObservabilityMiddleware } from './middleware'

import { Logger, NoopLogger, type LogLevel } from './logger'
import { Tracer, NoopTracer } from './tracer'

export interface ObservabilityConfig {
  enabled: boolean
  logs: {
    level: LogLevel
    output: 'stderr' | 'stdout' | 'file' | 'session'
    filePath?: string
  }
  traces: {
    output: 'stderr' | 'stdout' | 'file' | 'session'
    filePath?: string
  }
}

export interface Observability {
  logger: Logger
  tracer: Tracer
}

export function createObservability(config: ObservabilityConfig, sessionId?: string): Observability {
  if (!config.enabled) {
    return { logger: new NoopLogger(), tracer: new NoopTracer() }
  }

  const logger = new Logger({
    level: config.logs.level,
    output: config.logs.output,
    filePath: config.logs.filePath,
    sessionId,
  })

  const tracer = new Tracer({
    output: config.traces.output,
    filePath: config.traces.filePath,
    sessionId,
  })

  return { logger, tracer }
}
