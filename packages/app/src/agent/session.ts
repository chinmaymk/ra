import type { MiddlewareConfig, LogLevel, Logger } from '@chinmaymk/ra'
import { mergeMiddleware, NoopLogger } from '@chinmaymk/ra'
import type { SessionStorage } from '../storage/sessions'
import { createObservability, createObservabilityMiddleware } from '../observability'
import { createHistoryMiddleware } from '../storage/middleware'

/**
 * Composes all per-session middleware for an AgentLoop:
 *   observability → base (user/config) → history persistence → flush
 */
export function createSessionMiddleware(
  baseMiddleware: Partial<MiddlewareConfig> | undefined,
  options: {
    storage: SessionStorage
    sessionId: string
    priorCount?: number
    logsEnabled?: boolean
    logLevel?: LogLevel
    tracesEnabled?: boolean
    logger?: Logger
  },
): { middleware: Partial<MiddlewareConfig>; logger: Logger } {
  const logsEnabled = options.logsEnabled ?? false
  const tracesEnabled = options.tracesEnabled ?? false

  const { logger, tracer } = createObservability({
    enabled: logsEnabled || tracesEnabled,
    logs: { enabled: logsEnabled, level: options.logLevel ?? 'info', output: 'session' },
    traces: { enabled: tracesEnabled, output: 'session' },
  }, { sessionId: options.sessionId, sessionDir: options.storage.sessionDir(options.sessionId) })

  const hasObs = logsEnabled || tracesEnabled
  const obsHooks = hasObs ? createObservabilityMiddleware(logger, tracer) : undefined
  const flushHooks = hasObs ? {
    afterLoopComplete: [async () => { await logger.flush(); await tracer.flush() }],
    onError: [async () => { await logger.flush(); await tracer.flush() }],
  } as Partial<MiddlewareConfig> : undefined

  const historyHooks = createHistoryMiddleware(options.storage, options.priorCount)
  const middleware = mergeMiddleware(obsHooks, baseMiddleware, historyHooks, flushHooks)

  return { middleware, logger: hasObs ? logger : (options.logger ?? new NoopLogger()) }
}
