import type { ModelCallContext, Middleware } from '@chinmaymk/ra'
import type { PatternResolver } from './resolvers'
import { resolvePatterns, formatResolvedReferences } from './resolvers'

const RESOLVED_MARKER = '\n<!-- ra:resolved -->'

/**
 * Creates a beforeModelCall middleware that resolves pattern references
 * in the last user message and appends resolved content.
 *
 * Only processes the last user message. Skips messages already resolved
 * (marked in a previous iteration) to avoid duplicate work in agentic loops.
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
    if (!text || text.includes(RESOLVED_MARKER)) return

    const result = await resolvePatterns(text, resolvers, cwd)
    if (result.references.length === 0) return

    const resolved = formatResolvedReferences(result.references)
    messages[lastUserIdx] = {
      ...msg,
      content: `${text}\n\n${resolved}${RESOLVED_MARKER}`,
    }
  }
}
