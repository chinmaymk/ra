import type { LoopContext } from '../agent/types'
import type { MemoryStore } from './store'
import type { MemoryExtractor } from './extractor'
import { DefaultMemoryExtractor } from './extractor'

export interface MemoryMiddlewareOptions {
  store: MemoryStore
  extractor?: MemoryExtractor
}

/**
 * Creates middleware that auto-extracts memories from conversation
 * at the end of each loop iteration.
 */
export function createMemoryMiddleware(options: MemoryMiddlewareOptions) {
  const extractor = options.extractor ?? new DefaultMemoryExtractor()
  const { store } = options

  return {
    /** Prune expired memories at loop start */
    beforeLoopBegin: async (_ctx: LoopContext): Promise<void> => {
      store.prune()
    },

    /** Extract and save memories after each iteration */
    afterLoopIteration: async (ctx: LoopContext): Promise<void> => {
      // Only look at the most recent messages from this iteration
      // to avoid re-extracting from older messages
      const recent = ctx.messages.slice(-10)
      const entries = extractor.extract(recent)
      for (const entry of entries) {
        store.save(entry.content, entry.tags)
      }
      store.enforceMaxSize()
    },
  }
}
