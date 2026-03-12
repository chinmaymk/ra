import { errorMessage } from '../utils/errors'
import type { IMessage, IProvider } from '../providers/types'
import type { Middleware, ModelCallContext } from './types'
import { estimateTokens } from './token-estimator'
import { getContextWindowSize } from './model-registry'
import { serializeContent } from '../providers/utils'

export interface MessageZones {
  pinned: IMessage[]
  compactable: IMessage[]
  recent: IMessage[]
}

export function splitMessageZones(messages: IMessage[], recentBudgetTokens: number): MessageZones {
  // Pin: all leading system messages + first user message
  let pinnedEnd = 0
  let foundUser = false
  for (let i = 0; i < messages.length; i++) {
    pinnedEnd = i + 1
    if (messages[i]!.role === 'user') { foundUser = true; break }
  }
  // If no user message found, only pin leading system messages
  if (!foundUser) {
    pinnedEnd = 0
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.role === 'system') pinnedEnd = i + 1
      else break
    }
  }
  const pinned = messages.slice(0, pinnedEnd)
  const rest = messages.slice(pinnedEnd)

  if (rest.length === 0) {
    return { pinned, compactable: [], recent: [] }
  }

  // Recent: walk backward from end, accumulating tokens up to budget
  let recentStart = rest.length
  let recentTokens = 0
  for (let i = rest.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([rest[i]!])
    if (recentTokens + msgTokens > recentBudgetTokens && recentStart < rest.length) break
    recentTokens += msgTokens
    recentStart = i
  }

  // Adjust boundary to not split tool call groups
  recentStart = adjustToolCallBoundary(rest, recentStart)

  const compactable = rest.slice(0, recentStart)
  const recent = rest.slice(recentStart)

  return { pinned, compactable, recent }
}

function adjustToolCallBoundary(messages: IMessage[], boundary: number): number {
  if (boundary <= 0 || boundary >= messages.length) return boundary

  const firstRecent = messages[boundary]!
  // If the boundary lands on a tool result, move backward to include its assistant message
  if (firstRecent.role === 'tool') {
    for (let i = boundary - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant' && messages[i]!.toolCalls) {
        return i
      }
      // Stop searching if we hit a non-tool, non-assistant message (avoid matching unrelated tool groups)
      if (messages[i]!.role !== 'tool') break
    }
  }

  // If boundary lands right after an assistant with toolCalls, include the assistant + its tools together
  const beforeBoundary = messages[boundary - 1]
  if (beforeBoundary?.role === 'assistant' && beforeBoundary.toolCalls) {
    return boundary - 1
  }

  return boundary
}

import type { ContentPart } from '../providers/types'

/** Append extra text (and optional non-text parts) to a message, preserving its content type. */
function appendToMessage(msg: IMessage, text: string, extraParts: ContentPart[] = []): IMessage {
  if (typeof msg.content === 'string' && extraParts.length === 0) {
    return { ...msg, content: `${msg.content}\n\n${text}` }
  }
  const base = typeof msg.content === 'string'
    ? [{ type: 'text' as const, text: msg.content }]
    : [...msg.content]
  return { ...msg, content: [...base, { type: 'text' as const, text: `\n\n${text}` }, ...extraParts] }
}

export interface CompactionConfig {
  enabled: boolean
  threshold: number
  maxTokens?: number
  contextWindow?: number
  model?: string
  onCompact?: (info: { originalMessages: number; compactedMessages: number; estimatedTokens: number; threshold: number }) => void
}

const SUMMARIZATION_PROMPT = `Summarize the following conversation concisely. Preserve:
- Key decisions made
- Important facts and context established
- Current state of the task being worked on
- Relevant tool results and their outcomes

Be concise but complete. This summary will replace the original messages in the conversation context.

Conversation to summarize:`

export function createCompactionMiddleware(
  provider: IProvider,
  config: CompactionConfig,
): Middleware<ModelCallContext> {
  return async (ctx: ModelCallContext) => {
    if (!config.enabled) return

    const messages = ctx.request.messages
    const estimated = ctx.loop.lastUsage?.inputTokens ?? estimateTokens(messages)

    const contextWindow = getContextWindowSize(ctx.request.model, config.contextWindow)
    const triggerThreshold = config.maxTokens ?? Math.floor(contextWindow * config.threshold)

    if (estimated <= triggerThreshold) return

    const targetPostCompaction = Math.floor(contextWindow * 0.20)
    const { pinned, compactable, recent } = splitMessageZones(messages, targetPostCompaction)

    if (compactable.length === 0) return

    const conversationText = compactable.map(m => {
      const content = serializeContent(m.content)
      const toolInfo = m.toolCalls ? ` [tool calls: ${m.toolCalls.map(t => t.name).join(', ')}]` : ''
      const toolId = m.toolCallId ? ` [tool result for: ${m.toolCallId}]` : ''
      return `${m.role}${toolInfo}${toolId}: ${content}`
    }).join('\n')

    let summaryResponse
    try {
      const compactionModel = config.model || ctx.request.model
      summaryResponse = await provider.chat({
        model: compactionModel,
        messages: [{ role: 'user', content: `${SUMMARIZATION_PROMPT}\n\n${conversationText}` }],
      })
    } catch (err) {
      console.error('[compaction] summarization failed:', errorMessage(err))
      return // Leave messages unchanged on summarization failure
    }

    const summaryContent = serializeContent(summaryResponse.message.content)

    const summaryText = `[Context Summary]\n${summaryContent}`

    // Merge summary into the last pinned user message to avoid consecutive user messages.
    // Pinned always ends with a user message. If recent also starts with user, merge that too.
    const mergedPinned = [...pinned]
    let mergedRecent = [...recent]

    // Find the last pinned user message to merge into
    const userIdx = mergedPinned.findLastIndex(m => m.role === 'user')
    if (userIdx >= 0) {
      let extraText = summaryText
      let nonTextParts: ContentPart[] = []

      // Absorb first recent user message if present (avoids consecutive user messages)
      if (mergedRecent.length > 0 && mergedRecent[0]!.role === 'user') {
        const recentMsg = mergedRecent[0]!
        if (typeof recentMsg.content === 'string') {
          extraText += `\n\n${recentMsg.content}`
        } else {
          const text = recentMsg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('\n')
          if (text) extraText += `\n\n${text}`
          nonTextParts = recentMsg.content.filter(p => p.type !== 'text')
        }
        mergedRecent = mergedRecent.slice(1)
      }

      mergedPinned[userIdx] = appendToMessage(mergedPinned[userIdx]!, extraText, nonTextParts)
    }
    const originalCount = messages.length
    ctx.request.messages.length = 0
    ctx.request.messages.push(...mergedPinned, ...mergedRecent)
    config.onCompact?.({
      originalMessages: originalCount,
      compactedMessages: ctx.request.messages.length,
      estimatedTokens: estimated,
      threshold: triggerThreshold,
    })
  }
}
