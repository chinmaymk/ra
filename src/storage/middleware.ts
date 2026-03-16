import type { LoopContext, ErrorContext } from '../agent/types'
import type { SessionStorage } from './sessions'

/**
 * Creates middleware that persists messages to session storage in real time.
 *
 * Hooks into `afterLoopIteration` — after each model call + tool execution
 * cycle, any new messages (assistant responses, tool results) are immediately
 * appended to the session's JSONL file.  This ensures observability even if
 * the process crashes mid-run (CI, long HTTP requests, etc.).
 *
 * State is tracked per sessionId so concurrent loop runs (e.g. parallel HTTP
 * requests) do not interfere with each other.
 */
export function createSessionHistoryMiddleware(storage: SessionStorage) {
  // Per-session tracking of how many messages have been persisted.
  // Keyed by sessionId so concurrent loops don't share mutable state.
  const persistedCounts = new Map<string, number>()

  const beforeLoopBegin = async (ctx: LoopContext): Promise<void> => {
    // Record the initial message count so we only persist messages the loop adds
    persistedCounts.set(ctx.sessionId, ctx.messages.length)
  }

  const afterLoopIteration = async (ctx: LoopContext): Promise<void> => {
    const lastCount = persistedCounts.get(ctx.sessionId) ?? 0
    const newMessages = ctx.messages.slice(lastCount)
    if (newMessages.length > 0) {
      await storage.appendMessages(ctx.sessionId, newMessages)
      persistedCounts.set(ctx.sessionId, ctx.messages.length)
    }
  }

  const cleanup = (sessionId: string) => { persistedCounts.delete(sessionId) }

  const afterLoopComplete = async (ctx: LoopContext): Promise<void> => { cleanup(ctx.sessionId) }

  const onError = async (ctx: ErrorContext): Promise<void> => { cleanup(ctx.loop.sessionId) }

  return { beforeLoopBegin, afterLoopIteration, afterLoopComplete, onError }
}
