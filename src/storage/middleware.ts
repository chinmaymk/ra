import type { LoopContext, ModelCallContext, MiddlewareConfig } from '../agent/types'
import type { SessionStorage } from './sessions'
import { createObservability, createObservabilityMiddleware, type ObservabilityConfig } from '../observability'
import type { Logger } from '../observability/logger'
import type { Tracer } from '../observability/tracer'

/**
 * Creates per-session middleware hooks that persist messages to storage in
 * real time.  Each call returns a fresh set of hooks with their own closure
 * state — no shared mutable maps, no concurrency concerns.
 *
 * Hooks into `afterLoopIteration` to append new messages after each model
 * call + tool execution cycle.  A `beforeModelCall` hook tracks the message
 * count after context compaction (which shrinks the array in-place) so the
 * iteration hook knows where "new" messages start.
 */
function createSessionHistoryHooks(storage: SessionStorage) {
  let lastCount = 0

  const beforeLoopBegin = async (ctx: LoopContext): Promise<void> => {
    lastCount = ctx.messages.length
  }

  const beforeModelCall = async (ctx: ModelCallContext): Promise<void> => {
    // Context compaction (a prior beforeModelCall middleware) may have shrunk
    // the messages array in-place.  Snap the baseline to the compacted length
    // so afterLoopIteration captures messages added during this iteration.
    if (ctx.request.messages.length < lastCount) {
      lastCount = ctx.request.messages.length
    }
  }

  const afterLoopIteration = async (ctx: LoopContext): Promise<void> => {
    const newMessages = ctx.messages.slice(lastCount)
    if (newMessages.length > 0) {
      await storage.appendMessages(ctx.sessionId, newMessages)
    }
    lastCount = ctx.messages.length
  }

  return { beforeLoopBegin, beforeModelCall, afterLoopIteration }
}

/**
 * Returns a new middleware config with per-session history hooks merged in.
 * Call this each time you create an AgentLoop so each loop gets its own
 * isolated tracking state.
 */
export function withSessionHistory(
  middleware: Partial<MiddlewareConfig> | undefined,
  storage: SessionStorage,
): Partial<MiddlewareConfig> {
  const hooks = createSessionHistoryHooks(storage)
  const mw = middleware ?? {}
  return {
    ...mw,
    beforeLoopBegin: [...(mw.beforeLoopBegin ?? []), hooks.beforeLoopBegin],
    beforeModelCall: [...(mw.beforeModelCall ?? []), hooks.beforeModelCall],
    afterLoopIteration: [...(mw.afterLoopIteration ?? []), hooks.afterLoopIteration],
  }
}

export interface LoopMiddlewareOptions {
  storage: SessionStorage
  sessionId: string
  obsConfig?: ObservabilityConfig
}

export interface LoopMiddlewareResult {
  middleware: Partial<MiddlewareConfig>
  logger: Logger | undefined
  tracer: Tracer | undefined
}

/**
 * Creates all per-session middleware for an AgentLoop: observability (logs +
 * traces written to the session directory) and real-time message persistence.
 *
 * Each invocation returns fresh closure state — safe for concurrent loops.
 *
 * Middleware ordering:
 *   [obs hooks]  →  [base hooks]  →  [history hooks]
 *
 * (Compaction is unshifted by AgentLoop's constructor, so it always runs first.)
 */
export function createLoopMiddleware(
  baseMiddleware: Partial<MiddlewareConfig> | undefined,
  options: LoopMiddlewareOptions,
): LoopMiddlewareResult {
  const base = baseMiddleware ?? {}
  let sessionLogger: Logger | undefined
  let sessionTracer: Tracer | undefined
  let merged: Partial<MiddlewareConfig> = { ...base }

  // ── Per-session observability ──────────────────────────────────────
  if (options.obsConfig) {
    const sessionDir = options.storage.sessionDir(options.sessionId)
    const { logger, tracer } = createObservability(options.obsConfig, {
      sessionId: options.sessionId,
      sessionDir,
    })
    sessionLogger = logger
    sessionTracer = tracer

    const obsMw = createObservabilityMiddleware(logger, tracer)

    // Prepend obs hooks so they run before user/system middleware
    for (const key of Object.keys(obsMw)) {
      const k = key as keyof MiddlewareConfig
      ;(merged as any)[k] = [...((obsMw as any)[k] ?? []), ...((base as any)[k] ?? [])]
    }

    // Flush writers after loop completes or on error
    const flush = async () => { await logger.flush(); await tracer.flush() }
    merged.afterLoopComplete = [...(merged.afterLoopComplete ?? []), async () => { await flush() }]
    merged.onError = [...(merged.onError ?? []), async () => { await flush() }]
  }

  // ── Per-session message persistence ────────────────────────────────
  const history = createSessionHistoryHooks(options.storage)
  merged.beforeLoopBegin = [...(merged.beforeLoopBegin ?? []), history.beforeLoopBegin]
  merged.beforeModelCall = [...(merged.beforeModelCall ?? []), history.beforeModelCall]
  merged.afterLoopIteration = [...(merged.afterLoopIteration ?? []), history.afterLoopIteration]

  return { middleware: merged, logger: sessionLogger, tracer: sessionTracer }
}
