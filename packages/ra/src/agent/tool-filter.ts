import type { ITool } from '../providers/types'
import type { Middleware, ModelCallContext } from './types'

export type ToolFilterFn = (tool: ITool, ctx: ModelCallContext) => boolean

/** Creates a beforeModelCall middleware that filters tools sent to the provider. */
export function createToolFilterMiddleware(filter: ToolFilterFn): Middleware<ModelCallContext> {
  return async (ctx: ModelCallContext) => {
    if (!ctx.request.tools?.length) return
    ctx.request.tools = ctx.request.tools.filter(t => filter(t, ctx))
  }
}

export interface RecentlyUsedFilterOptions {
  /** Tools to always include regardless of recency. */
  baseTools?: string[]
  /** Number of past iterations to consider for recently-used tools. Default 3. */
  window?: number
}

/**
 * Built-in filter: keeps tools used in the last N iterations plus a base set.
 * On the first iteration (no history yet), all tools pass through.
 */
export function createRecentlyUsedFilter(options: RecentlyUsedFilterOptions = {}): ToolFilterFn {
  const baseSet = new Set(options.baseTools ?? [])
  const window = options.window ?? 3
  let recentToolNames = new Set<string>()
  let lastTrackedIteration = 0

  return (tool: ITool, ctx: ModelCallContext): boolean => {
    const iteration = ctx.loop.iteration
    if (iteration <= 1) return true

    // Rebuild recent tool set when iteration advances
    if (iteration !== lastTrackedIteration) {
      lastTrackedIteration = iteration
      recentToolNames = new Set<string>()
      // Scan messages for tool calls within the window
      let iterationsSeen = 0
      for (let i = ctx.loop.messages.length - 1; i >= 0; i--) {
        const msg = ctx.loop.messages[i]
        if (msg?.role === 'assistant' && msg.toolCalls) {
          for (const tc of msg.toolCalls) recentToolNames.add(tc.name)
          iterationsSeen++
          if (iterationsSeen >= window) break
        }
      }
    }

    return baseSet.has(tool.name) || recentToolNames.has(tool.name)
  }
}
