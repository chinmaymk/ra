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
  /** Session ID for tagging session memories */
  sessionId?: string
}

/**
 * Creates middleware for the layered memory system.
 *
 * - beforeLoopBegin: prunes expired memories
 * - afterLoopIteration: pattern-based extraction into session layer
 * - afterLoopComplete: LLM-driven reflection to promote learnings to long-term
 */
export function createMemoryMiddleware(options: MemoryMiddlewareOptions) {
  const { store, provider, reflectionModel, sessionId = '' } = options
  const patternExtractor = options.extractor ?? new PatternExtractor(options.patterns ?? DEFAULT_PATTERNS)
  const reflectiveExtractor = provider ? new ReflectiveExtractor(provider, reflectionModel) : null

  return {
    /** Prune expired memories at loop start */
    beforeLoopBegin: async (_ctx: LoopContext): Promise<void> => {
      store.prune()
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
          layer: entry.layer,
          sessionId: entry.layer === 'session' ? (sessionId || ctx.sessionId) : '',
        })
      }
      store.enforceMaxSize()
    },
  }
}
