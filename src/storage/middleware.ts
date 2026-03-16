import type { LoopContext, ModelCallContext, MiddlewareConfig } from '../agent/types'
import type { SessionStorage } from './sessions'
import { createObservability, createObservabilityMiddleware, type ObservabilityConfig } from '../observability'
import { NoopLogger, type Logger } from '../observability/logger'

// ── Helpers ──────────────────────────────────────────────────────────

const HOOK_KEYS: (keyof MiddlewareConfig)[] = [
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
]

/**
 * Concatenates multiple partial middleware configs into a full
 * MiddlewareConfig.  Hooks from later layers run after earlier layers.
 * Missing hooks become empty arrays.
 */
function concatMiddleware(
  ...layers: (Partial<MiddlewareConfig> | undefined)[]
): MiddlewareConfig {
  const result: Record<string, unknown[]> = {}
  for (const key of HOOK_KEYS) result[key] = []
  for (const layer of layers) {
    if (!layer) continue
    for (const key of HOOK_KEYS) {
      const incoming = layer[key] as unknown[] | undefined
      if (incoming?.length) result[key]!.push(...incoming)
    }
  }
  return result as unknown as MiddlewareConfig
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
 * composed middleware and a logger (session-scoped if obs is enabled,
 * otherwise the provided fallback or a no-op).
 *
 * Flow:
 *   1. Create per-session observability (logger + tracer → obs hooks)
 *   2. Create per-session history hooks
 *   3. Concatenate:  obs → base → history → flush
 *
 * Each call returns fresh closure state — safe for concurrent loops.
 */
export function createLoopMiddleware(
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

  const historyHooks = createHistoryHooks(options.storage)
  const middleware = concatMiddleware(obsHooks, baseMiddleware, historyHooks, flushHooks)
  const logger = sessionLogger ?? options.logger ?? new NoopLogger()

  return { middleware, logger }
}
