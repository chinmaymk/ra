import type { LoopContext } from '../agent/types'
import type { IProvider } from '../providers/types'
import type { MemoryStore } from './store'
import type { MemoryExtractor, ExtractionPattern } from './extractor'
import { PatternExtractor, ReflectiveExtractor, DEFAULT_PATTERNS } from './extractor'

export interface MemoryMiddlewareOptions {
  store: MemoryStore
  /** Custom pattern extractor (overrides patterns option) */
  extractor?: MemoryExtractor
  /** Custom patterns to use with the default PatternExtractor */
  patterns?: ExtractionPattern[]
  /** Provider for LLM-driven reflective extraction at end of loop */
  provider?: IProvider
  /** Model to use for reflection (defaults to provider default) */
  reflectionModel?: string
  /** Custom prompt for reflection. Must contain {CONVERSATION} placeholder. */
  reflectionPrompt?: string
  /** Session ID for tagging session memories */
  sessionId?: string
  /** Number of long-term memories to inject as context at loop start (default: 20) */
  injectLimit?: number
}

/**
 * Creates middleware for the layered memory system.
 *
 * - beforeLoopBegin: prunes expired memories
 * - afterLoopIteration: pattern-based extraction into session layer
 * - afterLoopComplete: LLM-driven reflection to promote learnings to long-term
 */
export function createMemoryMiddleware(options: MemoryMiddlewareOptions) {
  const { store, provider, reflectionModel, reflectionPrompt, sessionId = '', injectLimit = 20 } = options
  const patternExtractor = options.extractor ?? new PatternExtractor(options.patterns ?? DEFAULT_PATTERNS)
  const reflectiveExtractor = provider ? new ReflectiveExtractor(provider, reflectionModel, reflectionPrompt) : null

  return {
    /** Prune expired memories and inject recalled memories as context */
    beforeLoopBegin: async (ctx: LoopContext): Promise<void> => {
      store.prune()

      if (injectLimit <= 0) return

      const lines: string[] = []
      const longTerm = store.list({ layer: 'long-term', limit: injectLimit })
      for (const m of longTerm) {
        lines.push(`- [${m.tags || 'general'}] ${m.content}`)
      }

      const sid = sessionId || ctx.sessionId
      if (sid) {
        const session = store.getSessionContext(sid, injectLimit)
        for (const m of session) {
          lines.push(`- [session${m.tags ? `, ${m.tags}` : ''}] ${m.content}`)
        }
      }

      if (lines.length > 0) {
        ctx.messages.push({
          role: 'user',
          content: `<recalled-memories>\n${lines.join('\n')}\n</recalled-memories>`,
        })
      }
    },

    /** Pattern-based extraction after each iteration (fast, no LLM call) */
    afterLoopIteration: async (ctx: LoopContext): Promise<void> => {
      const recent = ctx.messages.slice(-10)
      const entries = patternExtractor.extract(recent)
      for (const entry of entries) {
        store.save(entry.content, {
          tags: entry.tags,
          layer: entry.layer,
          sessionId: sessionId || ctx.sessionId,
        })
      }
      store.enforceMaxSize()
    },

    /** LLM-driven reflective extraction at end of loop */
    afterLoopComplete: async (ctx: LoopContext): Promise<void> => {
      if (!reflectiveExtractor) return
      // Only reflect if there was a meaningful conversation
      if (ctx.iteration < 1) return

      const entries = await reflectiveExtractor.extractAsync(ctx.messages)
      for (const entry of entries) {
        store.save(entry.content, {
          tags: entry.tags,
          layer: 'long-term',
        })
      }
      store.enforceMaxSize()
    },
  }
}
