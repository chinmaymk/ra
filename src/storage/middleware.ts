import type { LoopContext, ModelCallContext, MiddlewareConfig } from '../agent/types'
import type { SessionStorage } from './sessions'
import { createObservability, createObservabilityMiddleware, type ObservabilityConfig } from '../observability'
import type { Logger } from '../observability/logger'

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Concatenates multiple partial middleware configs into one.  Hooks from
 * later layers run after hooks from earlier layers.
 *
 *   concatMiddleware(obsHooks, baseHooks, historyHooks)
 *   // → each hook array is [...obs, ...base, ...history]
 */
function concatMiddleware(
  ...layers: (Partial<MiddlewareConfig> | undefined)[]
): Partial<MiddlewareConfig> {
  const result: Partial<MiddlewareConfig> = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const key of Object.keys(layer) as (keyof MiddlewareConfig)[]) {
      const existing = result[key] as unknown[] | undefined
      const incoming = layer[key] as unknown[] | undefined
      if (incoming?.length) {
        ;(result as Record<string, unknown[]>)[key] = [...(existing ?? []), ...incoming]
      }
    }
  }
  return result
}

/**
 * Returns middleware hooks that persist new messages to storage in real
 * time.  Each call returns fresh closure state — safe for concurrent use.
 *
 * `beforeLoopBegin` snapshots the initial message count.
 * `beforeModelCall` re-snapshots after context compaction shrinks the array.
 * `afterLoopIteration` appends only the messages added since the snapshot.
 */
function createHistoryHooks(storage: SessionStorage): Partial<MiddlewareConfig> {
  let lastCount = 0

  return {
    beforeLoopBegin: [async (ctx: LoopContext) => {
      lastCount = ctx.messages.length
    }],
    beforeModelCall: [async (ctx: ModelCallContext) => {
      if (ctx.request.messages.length < lastCount) {
        lastCount = ctx.request.messages.length
      }
    }],
    afterLoopIteration: [async (ctx: LoopContext) => {
      const newMessages = ctx.messages.slice(lastCount)
      if (newMessages.length > 0) {
        await storage.appendMessages(ctx.sessionId, newMessages)
      }
      lastCount = ctx.messages.length
    }],
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Creates all per-session middleware for an AgentLoop.  Returns the
 * composed middleware and an optional per-session logger.
 *
 * Flow:
 *   1. Create per-session observability (logger + tracer → obs hooks)
 *   2. Create per-session history hooks
 *   3. Concatenate:  obs → base → history
 *   4. Append flush hooks so buffered data hits disk
 *
 * Each call returns fresh closure state — safe for concurrent loops.
 */
export function createLoopMiddleware(
  baseMiddleware: Partial<MiddlewareConfig> | undefined,
  options: {
    storage: SessionStorage
    sessionId: string
    obsConfig?: ObservabilityConfig
  },
): { middleware: Partial<MiddlewareConfig>; logger: Logger | undefined } {
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

  const historyHooks = createHistoryHooks(options.storage)

  // obs runs first → user/system base → history last → flush last
  const middleware = concatMiddleware(obsHooks, baseMiddleware, historyHooks, flushHooks)

  return { middleware, logger: sessionLogger }
}
