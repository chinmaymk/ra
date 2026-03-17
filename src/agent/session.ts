import type { MiddlewareConfig } from './types'
import type { SessionStorage } from '../storage/sessions'
import type { ObservabilityConfig } from '../observability'
import type { Logger } from '../observability/logger'
import { NoopLogger } from '../observability/logger'
import { createObservability, createObservabilityMiddleware } from '../observability'
import { createHistoryMiddleware } from '../storage/middleware'
import { mergeMiddleware } from './middleware'

/**
 * Composes all per-session middleware for an AgentLoop:
 *   observability → base (user/config) → history persistence → flush
 *
 * Sessions are always created. Observability always writes to the session
 * directory when an obsConfig is provided.
 */
export function createSessionMiddleware(
  baseMiddleware: Partial<MiddlewareConfig> | undefined,
  options: {
    storage: SessionStorage
    sessionId: string
    priorCount?: number
    obsConfig?: ObservabilityConfig
    logger?: Logger
  },
): { middleware: Partial<MiddlewareConfig>; logger: Logger } {
  const sessionDir = options.storage.sessionDir(options.sessionId)
  const { logger, tracer } = options.obsConfig
    ? createObservability(options.obsConfig, { sessionId: options.sessionId, sessionDir })
    : { logger: undefined, tracer: undefined }

  const obsHooks = logger && tracer ? createObservabilityMiddleware(logger, tracer) : undefined
  const flushHooks = logger && tracer ? {
    afterLoopComplete: [async () => { await logger.flush(); await tracer.flush() }],
    onError: [async () => { await logger.flush(); await tracer.flush() }],
  } as Partial<MiddlewareConfig> : undefined

  const historyHooks = createHistoryMiddleware(options.storage, options.priorCount)
  const middleware = mergeMiddleware(obsHooks, baseMiddleware, historyHooks, flushHooks)

  return { middleware, logger: logger ?? options.logger ?? new NoopLogger() }
}
