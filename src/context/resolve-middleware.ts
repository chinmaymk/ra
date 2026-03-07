import type { ModelCallContext, Middleware } from '../agent/types'
import type { PatternResolver } from './resolvers'
import { resolvePatterns, formatResolvedReferences } from './resolvers'

/**
 * Creates a beforeModelCall middleware that resolves pattern references
 * in the last user message and appends resolved content.
 *
 * Only processes the last user message to avoid re-resolving
 * already-processed messages from earlier turns.
 */
export function createResolverMiddleware(
  resolvers: PatternResolver[],
  cwd: string,
): Middleware<ModelCallContext> {
  return async (ctx: ModelCallContext) => {
    if (resolvers.length === 0) return

    const messages = ctx.request.messages

    // Find the last user message
    let lastUserIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]!.role === 'user') {
        lastUserIdx = i
        break
      }
    }
    if (lastUserIdx === -1) return

    const msg = messages[lastUserIdx]!
    const text = typeof msg.content === 'string' ? msg.content : null
    if (!text) return

    const result = await resolvePatterns(text, resolvers, cwd)
    if (result.references.length === 0) return

    const resolved = formatResolvedReferences(result.references)
    messages[lastUserIdx] = {
      ...msg,
      content: `${text}\n\n${resolved}`,
    }
  }
}
