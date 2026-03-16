import type { LoopContext } from '../agent/types'
import type { SessionStorage } from './sessions'
import type { Logger } from '../observability/logger'
import type { Tracer } from '../observability/tracer'
import { mkdir } from 'node:fs/promises'

export interface SessionHistoryOptions {
  storage: SessionStorage
  logger?: Logger
  tracer?: Tracer
}

/**
 * Creates middleware that persists messages to session storage in real time
 * and routes observability logs/traces to the correct session directory.
 *
 * Hooks into `afterLoopIteration` — after each model call + tool execution
 * cycle, any new messages (assistant responses, tool results) are immediately
 * appended to the session's JSONL file.  This ensures observability even if
 * the process crashes mid-run (CI, long HTTP requests, etc.).
 *
 * Also redirects logger/tracer output to the per-session directory in
 * `beforeLoopBegin`, so logs and traces always land alongside the session's
 * messages.
 */
export function createSessionHistoryMiddleware(options: SessionHistoryOptions) {
  const { storage, logger, tracer } = options
  let lastPersistedCount = 0

  const beforeLoopBegin = async (ctx: LoopContext): Promise<void> => {
    // Record the initial message count so we only persist messages the loop adds
    lastPersistedCount = ctx.messages.length

    // Redirect logs/traces to the session directory for this loop run
    const sessionDir = storage.sessionDir(ctx.sessionId)
    await mkdir(sessionDir, { recursive: true })
    if (logger) await logger.setSessionDir(sessionDir)
    if (tracer) await tracer.setSessionDir(sessionDir)
  }

  const afterLoopIteration = async (ctx: LoopContext): Promise<void> => {
    const newMessages = ctx.messages.slice(lastPersistedCount)
    if (newMessages.length > 0) {
      await Promise.all(newMessages.map(msg => storage.appendMessage(ctx.sessionId, msg)))
      lastPersistedCount = ctx.messages.length
    }
  }

  return { beforeLoopBegin, afterLoopIteration }
}
