export { Logger, NoopLogger, type LogLevel, type LogEntry, type LoggerOptions } from './logger'
export { Tracer, NoopTracer, type Span, type SpanEvent, type TraceRecord, type TracerOptions } from './tracer'
export { createObservabilityMiddleware } from './middleware'

import type { Logger as ILogger, LogLevel } from '@chinmaymk/ra'
import { NoopLogger } from '@chinmaymk/ra'
import { Logger } from './logger'
import { Tracer, NoopTracer } from './tracer'

export interface ObservabilityConfig {
  enabled: boolean
  logs: {
    enabled?: boolean
    level: LogLevel
    output: 'stderr' | 'stdout' | 'file' | 'session'
    filePath?: string
  }
  traces: {
    enabled?: boolean
    output: 'stderr' | 'stdout' | 'file' | 'session'
    filePath?: string
  }
}

export interface Observability {
  logger: ILogger
  tracer: Tracer
}

export function createObservability(config: ObservabilityConfig, options?: { sessionId?: string; sessionDir?: string }): Observability {
  if (!config.enabled) {
    return { logger: new NoopLogger(), tracer: new NoopTracer() }
  }

  // Logs — individually toggleable
  const logsEnabled = config.logs.enabled ?? true
  let logger: ILogger
  if (!logsEnabled) {
    logger = new NoopLogger()
  } else {
    const logOutput = config.logs.output === 'session'
      ? (options?.sessionDir ? 'file' as const : 'stderr' as const)
      : config.logs.output
    const logFilePath = config.logs.output === 'session' && options?.sessionDir
      ? `${options.sessionDir}/logs.jsonl`
      : config.logs.filePath
    logger = new Logger({
      level: config.logs.level,
      output: logOutput,
      filePath: logFilePath,
      sessionId: options?.sessionId,
    })
  }

  // Traces — individually toggleable
  const tracesEnabled = config.traces.enabled ?? true
  let tracer: Tracer | NoopTracer
  if (!tracesEnabled) {
    tracer = new NoopTracer()
  } else {
    const traceOutput = config.traces.output === 'session'
      ? (options?.sessionDir ? 'file' as const : 'stderr' as const)
      : config.traces.output
    const traceFilePath = config.traces.output === 'session' && options?.sessionDir
      ? `${options.sessionDir}/traces.jsonl`
      : config.traces.filePath
    tracer = new Tracer({
      output: traceOutput,
      filePath: traceFilePath,
      sessionId: options?.sessionId,
    })
  }

  return { logger, tracer }
}
