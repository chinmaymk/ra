import type { LoopContext, ModelCallContext, MiddlewareConfig } from '../agent/types'
import type { SessionStorage } from './sessions'

/**
 * Returns middleware hooks that persist new messages to storage in real
 * time.  Each call returns fresh closure state — safe for concurrent use.
 *
 * `beforeLoopBegin` snapshots the initial message count.
 * `beforeModelCall` re-snapshots after context compaction shrinks the array.
 * `afterLoopIteration` appends only the messages added since the snapshot.
 */
export function createHistoryMiddleware(storage: SessionStorage): Partial<MiddlewareConfig> {
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
