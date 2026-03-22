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
  /** Number of past iterations to scan for recently-used tools. Default 3. */
  window?: number
}

/**
 * Built-in filter: keeps tools used in the last N iterations plus a base set.
 * On the first iteration (no history yet), all tools pass through.
 *
 * Cache-safe: once a tool enters the active set it stays permanently. Tools
 * are only ever added, never removed, so the Anthropic tool-definition cache
 * prefix remains stable across turns.
 */
export function createRecentlyUsedFilter(options: RecentlyUsedFilterOptions = {}): ToolFilterFn {
  const baseSet = new Set(options.baseTools ?? [])
  const window = options.window ?? 3
  /** Monotonic set — tools are added but never removed to preserve cache. */
  const seenTools = new Set<string>()
  let lastTrackedIteration = 0

  return (tool: ITool, ctx: ModelCallContext): boolean => {
    const iteration = ctx.loop.iteration
    if (iteration <= 1) return true

    // Scan for newly-used tools when iteration advances
    if (iteration !== lastTrackedIteration) {
      lastTrackedIteration = iteration
      let iterationsSeen = 0
      for (let i = ctx.loop.messages.length - 1; i >= 0; i--) {
        const msg = ctx.loop.messages[i]
        if (msg?.role === 'assistant' && msg.toolCalls) {
          for (const tc of msg.toolCalls) seenTools.add(tc.name)
          iterationsSeen++
          if (iterationsSeen >= window) break
        }
      }
    }

    return baseSet.has(tool.name) || seenTools.has(tool.name)
  }
}

export interface LazyToolLoadingOptions {
  /** Tools always included in every request. */
  eagerTools: string[]
  /** Tools only included after they appear in conversation or are mentioned by the model. */
  deferredTools?: string[]
}

/**
 * Lazy tool loading filter: starts with only eager tools. Deferred tools
 * are loaded once they've been used or returned by a tool_search result.
 *
 * Cache-safe: the `loadedTools` set only grows (monotonic), so the tool
 * definition prefix stays stable after each new tool loads. One cache miss
 * per newly-loaded tool, then stable.
 *
 * Note: with ~2K tokens for built-in tools, this filter is most useful when
 * many MCP or custom tools are registered. For small tool sets, the cache
 * miss from loading a new tool may cost more than just sending all tools.
 *
 * The caller is responsible for adding a meta-tool (e.g. tool_search) to
 * the registry if they want the model to discover deferred tools.
 * This filter only controls which tools are sent to the model.
 */
export function createLazyToolFilter(options: LazyToolLoadingOptions): ToolFilterFn {
  const eagerSet = new Set(options.eagerTools)
  const deferredSet = options.deferredTools ? new Set(options.deferredTools) : null
  /** Monotonic set — tools are added but never removed to preserve cache. */
  const loadedTools = new Set<string>()

  return (tool: ITool, ctx: ModelCallContext): boolean => {
    // Eager tools always pass
    if (eagerSet.has(tool.name)) return true
    // Already-loaded deferred tools pass
    if (loadedTools.has(tool.name)) return true

    // Scan messages to see if this tool was ever requested or used
    for (let i = ctx.loop.messages.length - 1; i >= 0; i--) {
      const msg = ctx.loop.messages[i]
      if (msg?.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.name === tool.name) {
            loadedTools.add(tool.name)
            return true
          }
        }
      }
      // Check if a tool_search result mentioned this tool
      if (msg?.role === 'tool' && typeof msg.content === 'string' && msg.content.includes(tool.name)) {
        loadedTools.add(tool.name)
        return true
      }
    }

    // If deferredTools is specified, only hide those; otherwise hide everything non-eager
    if (deferredSet) return !deferredSet.has(tool.name)
    return false
  }
}
