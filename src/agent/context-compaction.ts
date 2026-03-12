import type { IMessage, IProvider } from '../providers/types'
import type { Middleware, ModelCallContext } from './types'
import { estimateTokens } from './token-estimator'
import { getContextWindowSize } from './model-registry'
import { contentToJson, errMsg } from '../providers/utils'

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
  if (!foundUser) {
    pinnedEnd = 0
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.role === 'system') pinnedEnd = i + 1
      else break
    }
  }
  const pinned = messages.slice(0, pinnedEnd)
  const rest = messages.slice(pinnedEnd)

  if (rest.length === 0) return { pinned, compactable: [], recent: [] }

  // Recent: walk backward from end, accumulating tokens up to budget
  let recentStart = rest.length
  let recentTokens = 0
  for (let i = rest.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens([rest[i]!])
    if (recentTokens + msgTokens > recentBudgetTokens && recentStart < rest.length) break
    recentTokens += msgTokens
    recentStart = i
  }

  recentStart = adjustToolCallBoundary(rest, recentStart)
  return { pinned, compactable: rest.slice(0, recentStart), recent: rest.slice(recentStart) }
}

function adjustToolCallBoundary(messages: IMessage[], boundary: number): number {
  if (boundary <= 0 || boundary >= messages.length) return boundary

  const firstRecent = messages[boundary]!
  if (firstRecent.role === 'tool') {
    for (let i = boundary - 1; i >= 0; i--) {
      if (messages[i]!.role === 'assistant' && messages[i]!.toolCalls) return i
      if (messages[i]!.role !== 'tool') break
    }
  }

  const beforeBoundary = messages[boundary - 1]
  if (beforeBoundary?.role === 'assistant' && beforeBoundary.toolCalls) return boundary - 1

  return boundary
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

/** Append text to a message's content, preserving string vs ContentPart[] structure */
function appendToContent(msg: IMessage, text: string): IMessage {
  if (typeof msg.content === 'string') return { ...msg, content: `${msg.content}\n\n${text}` }
  return { ...msg, content: [...msg.content, { type: 'text' as const, text: `\n\n${text}` }] }
}

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
      const content = contentToJson(m.content)
      const toolInfo = m.toolCalls ? ` [tool calls: ${m.toolCalls.map(t => t.name).join(', ')}]` : ''
      const toolId = m.toolCallId ? ` [tool result for: ${m.toolCallId}]` : ''
      return `${m.role}${toolInfo}${toolId}: ${content}`
    }).join('\n')

    let summaryResponse
    try {
      summaryResponse = await provider.chat({
        model: config.model || ctx.request.model,
        messages: [{ role: 'user', content: `${SUMMARIZATION_PROMPT}\n\n${conversationText}` }],
      })
    } catch (err) {
      console.error('[compaction] summarization failed:', errMsg(err))
      return
    }

    const summaryText = `[Context Summary]\n${contentToJson(summaryResponse.message.content)}`

    // Merge summary into the last pinned user message to avoid consecutive user messages
    const mergedPinned = [...pinned]
    let mergedRecent = [...recent]

    for (let i = mergedPinned.length - 1; i >= 0; i--) {
      if (mergedPinned[i]!.role !== 'user') continue

      let extraText = summaryText

      // Absorb first recent user message if present
      if (mergedRecent.length > 0 && mergedRecent[0]!.role === 'user') {
        const recentMsg = mergedRecent[0]!
        if (typeof recentMsg.content === 'string') {
          extraText += `\n\n${recentMsg.content}`
        } else {
          const textParts = recentMsg.content.filter(p => p.type === 'text')
          const nonTextParts = recentMsg.content.filter(p => p.type !== 'text')
          const recentText = textParts.map(p => (p as { type: 'text'; text: string }).text).join('\n')
          if (recentText) extraText += `\n\n${recentText}`
          if (nonTextParts.length > 0) {
            // Append non-text parts directly to the merged message
            const base = appendToContent(mergedPinned[i]!, extraText)
            mergedPinned[i] = typeof base.content === 'string'
              ? { ...base, content: [{ type: 'text' as const, text: base.content as string }, ...nonTextParts] }
              : { ...base, content: [...(base.content as any[]), ...nonTextParts] }
            mergedRecent = mergedRecent.slice(1)
            break
          }
        }
        mergedRecent = mergedRecent.slice(1)
      }

      mergedPinned[i] = appendToContent(mergedPinned[i]!, extraText)
      break
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
