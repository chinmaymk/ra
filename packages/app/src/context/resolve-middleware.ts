import type { ModelCallContext, Middleware } from '@chinmaymk/ra'
import type { PatternResolver } from './resolvers'
import { resolvePatterns, formatResolvedReferences } from './resolvers'

const RESOLVED_MARKER = '\n<!-- ra:resolved -->'

/**
 * Resolve pattern references in a single message. Returns true if resolved.
 */
async function resolveMessage(
  messages: ModelCallContext['request']['messages'],
  idx: number,
  resolvers: PatternResolver[],
  cwd: string,
): Promise<{ resolved: boolean; refCount: number }> {
  const msg = messages[idx]
  if (!msg) return { resolved: false, refCount: 0 }
  const text = typeof msg.content === 'string' ? msg.content : null
  if (!text || text.includes(RESOLVED_MARKER)) return { resolved: false, refCount: 0 }

  const result = await resolvePatterns(text, resolvers, cwd)
  if (result.references.length === 0) return { resolved: false, refCount: 0 }

  const resolved = formatResolvedReferences(result.references)
  // Mutate in place so the history middleware's WeakSet still tracks this
  // object. Creating a new object would break change tracking and cause
  // duplicate entries in session storage.
  msg.content = `${text}\n\n${resolved}${RESOLVED_MARKER}`
  return { resolved: true, refCount: result.references.length }
}

/**
 * Creates a beforeModelCall middleware that resolves pattern references
 * in the system prompt and last user message, appending resolved content.
 *
 * Skips messages already resolved (marked in a previous iteration) to
 * avoid duplicate work in agentic loops.
 */
export function createResolverMiddleware(
  resolvers: PatternResolver[],
  cwd: string,
): Middleware<ModelCallContext> {
  return async (ctx: ModelCallContext) => {
    if (resolvers.length === 0) return

    const messages = ctx.request.messages
    const logger = ctx.logger

    // Resolve system prompt messages
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]?.role === 'system') {
        const { resolved, refCount } = await resolveMessage(messages, i, resolvers, cwd)
        if (resolved) {
          logger.info('context resolver resolved markers in system prompt', {
            messageIndex: i,
            referenceCount: refCount,
          })
        }
      }
    }

    // Find and resolve the last user message
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx === -1) return

    const { resolved, refCount } = await resolveMessage(messages, lastUserIdx, resolvers, cwd)
    if (resolved) {
      logger.info('context resolver resolved markers in user message', {
        messageIndex: lastUserIdx,
        referenceCount: refCount,
      })
    }
  }
}
