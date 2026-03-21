import type { LoopContext, MiddlewareConfig } from '@chinmaymk/ra'
import type { SessionStorage } from './sessions'

/**
 * Middleware that persists ALL messages to session storage.
 *
 * Tracks which messages have already been saved using a WeakSet so it
 * correctly handles context compaction removing/replacing messages.
 *
 * @param storage - Session storage instance
 * @param priorCount - Number of initial messages already on disk (e.g. from session resume).
 *                     Messages before this index are marked as already-saved.
 *                     Messages at and after this index are new and will be saved in beforeLoopBegin.
 */
export function createHistoryMiddleware(storage: SessionStorage, priorCount = 0): Partial<MiddlewareConfig> {
  const saved = new WeakSet<object>()

  return {
    beforeLoopBegin: [async (ctx: LoopContext) => {
      // Mark prior messages (system, context, session history) as already saved
      for (let i = 0; i < priorCount && i < ctx.messages.length; i++) {
        const msg = ctx.messages[i]
        if (msg) saved.add(msg)
      }
      // Save any new initial messages (e.g. user message, skill injections)
      const newInitial = ctx.messages.slice(priorCount).filter(m => !saved.has(m))
      if (newInitial.length > 0) {
        await storage.appendMessages(ctx.sessionId, newInitial)
        for (const msg of newInitial) saved.add(msg)
      }
    }],
    afterLoopIteration: [async (ctx: LoopContext) => {
      const unsaved = ctx.messages.filter(m => !saved.has(m))
      if (unsaved.length > 0) {
        await storage.appendMessages(ctx.sessionId, unsaved)
        for (const msg of unsaved) saved.add(msg)
      }
    }],
  }
}
