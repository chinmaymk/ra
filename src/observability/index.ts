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

export function createObservability(config: ObservabilityConfig, options?: { sessionId?: string; sessionDir?: string }): Observability {
  if (!config.enabled) {
    return { logger: new NoopLogger(), tracer: new NoopTracer() }
  }

  const logOutput = config.logs.output === 'session' ? 'file' as const : config.logs.output
  const logFilePath = config.logs.output === 'session' && options?.sessionDir
    ? `${options.sessionDir}/logs.jsonl`
    : config.logs.filePath

  const traceOutput = config.traces.output === 'session' ? 'file' as const : config.traces.output
  const traceFilePath = config.traces.output === 'session' && options?.sessionDir
    ? `${options.sessionDir}/traces.jsonl`
    : config.traces.filePath

  const logger = new Logger({
    level: config.logs.level,
    output: logOutput,
    filePath: logFilePath,
    sessionId: options?.sessionId,
  })

  const tracer = new Tracer({
    output: traceOutput,
    filePath: traceFilePath,
    sessionId: options?.sessionId,
  })

  return { logger, tracer }
}
