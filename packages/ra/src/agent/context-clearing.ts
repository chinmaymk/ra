import type { IMessage } from '../providers/types'
import type { Middleware, ModelCallContext } from './types'
import { estimateTokens } from './token-estimator'
import { getContextWindowSize } from './model-registry'

/**
 * Configuration for clearing old tool results from the conversation.
 * Replaces tool result content with a placeholder to save tokens,
 * while preserving the message structure for cache stability.
 */
export interface ToolResultClearingConfig {
  enabled: boolean
  /** Number of recent tool results to keep intact. Default 6. */
  keep?: number
  /** Minimum tokens to free when clearing. If clearing wouldn't free this many, skip. Default 500. */
  clearAtLeast?: number
  /** Tool names to never clear (e.g. tools whose output is always needed). */
  excludeTools?: string[]
  /** Placeholder text to replace cleared tool results. Default "[tool result cleared]". */
  placeholder?: string
}

/**
 * Configuration for clearing thinking blocks from older messages.
 * Thinking content from earlier turns can be massive and is rarely needed
 * once the model has acted on it.
 */
export interface ThinkingClearingConfig {
  enabled: boolean
  /** Number of recent assistant messages whose thinking to preserve. Default 2. */
  keepRecent?: number
}

const DEFAULT_KEEP = 6
const DEFAULT_CLEAR_AT_LEAST = 500
const DEFAULT_PLACEHOLDER = '[tool result cleared]'
const DEFAULT_KEEP_RECENT_THINKING = 2

/**
 * Clears old tool results from the message array in-place.
 * Returns the estimated tokens freed.
 *
 * Preserves message structure (role, toolCallId) so the conversation
 * remains valid and cache-friendly — only the content changes.
 */
export function clearOldToolResults(
  messages: IMessage[],
  config: ToolResultClearingConfig,
): number {
  const keep = config.keep ?? DEFAULT_KEEP
  const clearAtLeast = config.clearAtLeast ?? DEFAULT_CLEAR_AT_LEAST
  const placeholder = config.placeholder ?? DEFAULT_PLACEHOLDER
  const excludeSet = new Set(config.excludeTools ?? [])

  // Find all tool result messages with their indices
  const toolResultIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'tool') toolResultIndices.push(i)
  }

  // Keep the last `keep` tool results intact
  const clearableIndices = toolResultIndices.slice(0, Math.max(0, toolResultIndices.length - keep))
  if (clearableIndices.length === 0) return 0

  // Find which tool name each tool result belongs to by looking at the preceding assistant message
  const toolNameForResult = (idx: number): string | undefined => {
    const msg = messages[idx]
    if (!msg?.toolCallId) return undefined
    // Walk backward to find the assistant message with matching tool call
    for (let i = idx - 1; i >= 0; i--) {
      const m = messages[i]
      if (m?.role === 'assistant' && m.toolCalls) {
        const tc = m.toolCalls.find(t => t.id === msg.toolCallId)
        if (tc) return tc.name
      }
      if (m?.role !== 'tool') break
    }
    return undefined
  }

  // Calculate tokens that would be freed and apply clearing
  let tokensFreed = 0
  const toClear: number[] = []
  for (const idx of clearableIndices) {
    const msg = messages[idx]
    if (!msg) continue
    // Skip already-cleared messages
    if (typeof msg.content === 'string' && msg.content === placeholder) continue
    // Skip excluded tools
    const toolName = toolNameForResult(idx)
    if (toolName && excludeSet.has(toolName)) continue
    const before = estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
    const after = estimateTokens(placeholder)
    if (before > after) {
      toClear.push(idx)
      tokensFreed += before - after
    }
  }

  // Only clear if we free enough tokens to justify it
  if (tokensFreed < clearAtLeast) return 0

  for (const idx of toClear) {
    const msg = messages[idx]
    if (msg) msg.content = placeholder
  }
  return tokensFreed
}

/**
 * Clears thinking content from older assistant messages in-place.
 * Thinking blocks are stored as ContentPart[] with type 'thinking'.
 * In ra's IMessage format, thinking is typically embedded in the content.
 *
 * Since ra doesn't persist thinking blocks in IMessage.content (thinking
 * chunks are streamed but not stored in the message), this operates on
 * any assistant message content that contains thinking markers.
 *
 * Returns the estimated tokens freed.
 */
export function clearOldThinking(
  messages: IMessage[],
  config: ThinkingClearingConfig,
): number {
  const keepRecent = config.keepRecent ?? DEFAULT_KEEP_RECENT_THINKING

  // Find assistant messages (they may contain thinking in content parts)
  const assistantIndices: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === 'assistant') assistantIndices.push(i)
  }

  // Keep the last `keepRecent` assistant messages intact
  const clearableIndices = assistantIndices.slice(0, Math.max(0, assistantIndices.length - keepRecent))
  if (clearableIndices.length === 0) return 0

  let tokensFreed = 0
  for (const idx of clearableIndices) {
    const msg = messages[idx]
    if (!msg || typeof msg.content === 'string') continue
    if (!Array.isArray(msg.content)) continue

    // Filter out thinking parts from content array.
    // Thinking parts may exist as extended content types beyond the base ContentPart union.
    const filtered = msg.content.filter(part => (part as { type: string }).type !== 'thinking')
    if (filtered.length === msg.content.length) continue

    const beforeTokens = estimateTokens(JSON.stringify(msg.content))
    const afterTokens = filtered.length > 0 ? estimateTokens(JSON.stringify(filtered)) : 0
    tokensFreed += Math.max(0, beforeTokens - afterTokens)

    // Preserve at least one text part so the message isn't empty
    if (filtered.length > 0) {
      msg.content = filtered
    } else {
      msg.content = ''
    }
  }
  return tokensFreed
}

/**
 * Combined context clearing config for both tool results and thinking.
 */
export interface ContextClearingConfig {
  toolResults?: ToolResultClearingConfig
  thinking?: ThinkingClearingConfig
  /** Context usage ratio (0-1) at which clearing activates. Default 0.60. */
  triggerThreshold?: number
}

const DEFAULT_TRIGGER_THRESHOLD = 0.60

/**
 * Creates a beforeModelCall middleware that clears old tool results and
 * thinking blocks when context usage exceeds a threshold.
 *
 * This is lighter than full compaction — it preserves message structure
 * and cache breakpoints, only replacing content within existing messages.
 */
export function createContextClearingMiddleware(
  config: ContextClearingConfig,
): Middleware<ModelCallContext> {
  const triggerThreshold = config.triggerThreshold ?? DEFAULT_TRIGGER_THRESHOLD

  return async (ctx: ModelCallContext) => {
    const messages = ctx.request.messages
    const contextWindow = getContextWindowSize(ctx.request.model)
    const estimated = ctx.loop.lastUsage?.inputTokens ?? estimateTokens(messages)
    const usageRatio = estimated / contextWindow

    if (usageRatio < triggerThreshold) return

    let totalFreed = 0

    if (config.toolResults?.enabled) {
      const freed = clearOldToolResults(messages, config.toolResults)
      if (freed > 0) {
        totalFreed += freed
        ctx.logger.info('cleared old tool results', { tokensFreed: freed })
      }
    }

    if (config.thinking?.enabled) {
      const freed = clearOldThinking(messages, config.thinking)
      if (freed > 0) {
        totalFreed += freed
        ctx.logger.info('cleared old thinking blocks', { tokensFreed: freed })
      }
    }

    if (totalFreed > 0) {
      ctx.logger.info('context clearing complete', { totalTokensFreed: totalFreed, usageRatio })
    }
  }
}
