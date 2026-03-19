export { Logger, type LoggerOptions } from './logger'
export { type LogLevel, type LogEntry, NoopLogger } from '@chinmaymk/ra'
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

/** Resolve 'session' output to a concrete output type and file path. */
function resolveSessionOutput(
  output: string,
  filePath: string | undefined,
  sessionDir: string | undefined,
  filename: string,
): { output: 'stderr' | 'stdout' | 'file'; filePath?: string } {
  if (output === 'session') {
    return sessionDir
      ? { output: 'file', filePath: `${sessionDir}/${filename}` }
      : { output: 'stderr' }
  }
  return { output: output as 'stderr' | 'stdout' | 'file', filePath }
}

export function createObservability(config: ObservabilityConfig, options?: { sessionId?: string; sessionDir?: string }): Observability {
  if (!config.enabled) {
    return { logger: new NoopLogger(), tracer: new NoopTracer() }
  }

  const sessionId = options?.sessionId
  const sessionDir = options?.sessionDir

  const logger = (config.logs.enabled ?? true)
    ? new Logger({
        level: config.logs.level,
        ...resolveSessionOutput(config.logs.output, config.logs.filePath, sessionDir, 'logs.jsonl'),
        sessionId,
      })
    : new NoopLogger()

  const tracer = (config.traces.enabled ?? true)
    ? new Tracer({
        ...resolveSessionOutput(config.traces.output, config.traces.filePath, sessionDir, 'traces.jsonl'),
        sessionId,
      })
    : new NoopTracer()

  return { logger, tracer }
}
