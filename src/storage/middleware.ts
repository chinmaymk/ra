import type { LoopContext, ModelCallContext, MiddlewareConfig } from '../agent/types'
import type { SessionStorage } from './sessions'

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
