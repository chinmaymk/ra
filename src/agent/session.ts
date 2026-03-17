import type { MiddlewareConfig } from './types'
import type { SessionStorage } from '../storage/sessions'
import type { ObservabilityConfig } from '../observability'
import type { Logger } from '../observability/logger'
import { NoopLogger } from '../observability/logger'
import { createObservability, createObservabilityMiddleware } from '../observability'
import { createHistoryMiddleware } from '../storage/middleware'
import { concatMiddleware } from './middleware'

/**
 * Composes all per-session middleware for an AgentLoop:
 *   observability → base (user/config) → history persistence → flush
 *
 * Each concern is produced by its own module; this function only
 * concatenates the layers and resolves the session logger.
 *
 * Returns a full MiddlewareConfig (no undefined hooks) and a Logger.
 */
export function createSessionMiddleware(
  baseMiddleware: Partial<MiddlewareConfig> | undefined,
  options: {
    storage: SessionStorage
    sessionId: string
    obsConfig?: ObservabilityConfig
    logger?: Logger
  },
): { middleware: MiddlewareConfig; logger: Logger } {
  let obsHooks: Partial<MiddlewareConfig> | undefined
  let flushHooks: Partial<MiddlewareConfig> | undefined
  let sessionLogger: Logger | undefined

  if (options.obsConfig) {
    const sessionDir = options.storage.sessionDir(options.sessionId)
    const { logger, tracer } = createObservability(options.obsConfig, {
      sessionId: options.sessionId,
      sessionDir,
    })
    sessionLogger = logger
    obsHooks = createObservabilityMiddleware(logger, tracer)

    const flush = async () => { await logger.flush(); await tracer.flush() }
    flushHooks = {
      afterLoopComplete: [async () => { await flush() }],
      onError: [async () => { await flush() }],
    }
  }

  const historyHooks = createHistoryMiddleware(options.storage)
  const middleware = concatMiddleware(obsHooks, baseMiddleware, historyHooks, flushHooks)
  const logger = sessionLogger ?? options.logger ?? new NoopLogger()

  return { middleware, logger }
}
