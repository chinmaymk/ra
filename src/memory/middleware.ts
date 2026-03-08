import type { LoopContext } from '../agent/types'
import type { MemoryStore } from './store'

export interface MemoryMiddlewareOptions {
  store: MemoryStore
  /** Max memories to inject as context (default: 20, 0 to disable) */
  injectLimit?: number
}

/**
 * Creates memory middleware: prunes old memories and injects
 * existing memories as context at the start of each loop.
 */
export function createMemoryMiddleware(options: MemoryMiddlewareOptions) {
  const { store, injectLimit = 20 } = options

  return {
    beforeLoopBegin: async (ctx: LoopContext): Promise<void> => {
      store.prune()

      if (injectLimit <= 0) return

      const memories = store.list(injectLimit)
      if (memories.length === 0) return

      const lines = memories.map(m =>
        `- [${m.tags || 'general'}] ${m.content}`
      )
      ctx.messages.push({
        role: 'user',
        content:
          '<recalled-memories>\n' +
          'Facts saved from previous conversations. Use these to personalize responses. ' +
          'If any are outdated, use memory_forget to remove them.\n' +
          lines.join('\n') +
          '\n</recalled-memories>',
      })
    },
  }
}
