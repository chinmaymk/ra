import { randomUUID } from 'node:crypto'
import type { IMessage, LoopContext, MiddlewareConfig } from '@chinmaymk/ra'
import type { SessionStorage } from './sessions'

/** Assign a stable tracking ID to a message if it doesn't already have one. */
function ensureMessageId(msg: IMessage): string {
  if (!msg._messageId) msg._messageId = randomUUID()
  return msg._messageId
}

/**
 * Middleware that persists ALL messages to session storage.
 *
 * Tracks which messages have already been saved using their `_messageId`.
 * This is robust against object replacement (e.g. spread in middleware)
 * because the ID is copied along with other properties.
 *
 * @param storage - Session storage instance
 * @param priorCount - Number of initial messages already on disk (e.g. from session resume).
 *                     Messages before this index are marked as already-saved.
 *                     Messages at and after this index are new and will be saved in beforeLoopBegin.
 */
export function createHistoryMiddleware(storage: SessionStorage, priorCount = 0): Partial<MiddlewareConfig> {
  const savedIds = new Set<string>()

  /** Save any messages not yet persisted and mark them as saved. */
  async function persistUnsaved(ctx: LoopContext, messages: IMessage[], label: string): Promise<void> {
    const unsaved = messages.filter(m => !savedIds.has(ensureMessageId(m)))
    if (unsaved.length === 0) return
    await storage.appendMessages(ctx.sessionId, unsaved)
    for (const msg of unsaved) savedIds.add(msg._messageId!)
    ctx.logger.debug(label, { count: unsaved.length, sessionId: ctx.sessionId })
  }

  return {
    beforeLoopBegin: [async (ctx: LoopContext) => {
      // Mark prior messages (system, context, session history) as already saved
      for (let i = 0; i < priorCount && i < ctx.messages.length; i++) {
        const msg = ctx.messages[i]
        if (msg) savedIds.add(ensureMessageId(msg))
      }
      // Save any new initial messages (e.g. user message, skill injections)
      await persistUnsaved(ctx, ctx.messages.slice(priorCount), 'initial messages persisted')
    }],
    afterLoopIteration: [async (ctx: LoopContext) => {
      await persistUnsaved(ctx, ctx.messages, 'messages persisted')
    }],
  }
}
