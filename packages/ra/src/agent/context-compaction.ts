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
    : msg.content
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

// Patterns matched against err.message from each provider's SDK.
// Both Anthropic and OpenAI SDKs prefix messages with the HTTP status:
//   Anthropic → "400 prompt is too long: 208310 tokens > 200000 maximum"
//   OpenAI    → "400 This model's maximum context length is 128000 tokens..."
//
// Real error messages per provider:
//   Anthropic:  "prompt is too long: N tokens > M maximum"
//               "input length and max_tokens exceed context limit: N + M > L ..."
//               "request too large" / "Request too large"
//               "Request size exceeds model context window"
//   OpenAI:     "This model's maximum context length is N tokens..."
//   Azure:      same as OpenAI (uses openai SDK)
//   Ollama:     "prompt too long; exceeded max context length by N tokens"
//   Google:     "[400 Bad Request] ... exceeds the maximum number of tokens"
//   Bedrock:    "ValidationException: ... prompt too long ..." / "... too many tokens ..."
const CONTEXT_LENGTH_PATTERNS = [
  /maximum context length/i,        // OpenAI / Azure: "This model's maximum context length is..."
  /context.length.exceed/i,         // generic: "context length exceeded"
  /exceed.{0,20}context.limit/i,    // Anthropic: "...exceed context limit: ..."
  /exceeds?.{0,20}context.window/i, // Anthropic: "...exceeds model context window"
  /request too large/i,             // Anthropic 413: "request too large" / "Request too large"
  /prompt is too long/i,            // Anthropic 400: "prompt is too long: N tokens > M maximum"
  /prompt too long/i,               // Ollama: "prompt too long; exceeded max context length..."
  /too many tokens/i,               // generic / Bedrock
  /exceeds? the maximum/i,          // Google: "... exceeds the maximum number of tokens"
  /token.{0,10}limit/i,             // generic: "token limit exceeded", "token limit reached"
  /input.{0,5}too long/i,            // Bedrock: "Input is too long for requested model" / generic
]

export function isContextLengthError(err: unknown): boolean {
  // OpenAI SDK sets error.code = 'context_length_exceeded' — most reliable signal
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'context_length_exceeded') {
    return true
  }
  const msg = err instanceof Error ? err.message : String(err)
  return CONTEXT_LENGTH_PATTERNS.some(p => p.test(msg))
}

export async function forceCompact(
  provider: IProvider,
  config: CompactionConfig,
  ctx: ModelCallContext,
): Promise<boolean> {
  return _runCompaction(provider, config, ctx, true)
}

async function _runCompaction(
  provider: IProvider,
  config: CompactionConfig,
  ctx: ModelCallContext,
  force: boolean,
): Promise<boolean> {
  const messages = ctx.request.messages

  if (!force) {
    const estimated = ctx.loop.lastUsage?.inputTokens ?? estimateTokens(messages)
    const contextWindow = getContextWindowSize(ctx.request.model, config.contextWindow)
    const triggerThreshold = config.maxTokens ?? Math.floor(contextWindow * config.threshold)
    if (estimated <= triggerThreshold) return false
  }

  // Keep 20% of context window as recent messages when we know the window size,
  // otherwise use a conservative flat budget so we always compact aggressively.
  const contextWindow = config.contextWindow ?? getContextWindowSize(ctx.request.model)
  const targetPostCompaction = Math.floor(contextWindow * 0.20)
  const { pinned, compactable, recent } = splitMessageZones(messages, targetPostCompaction)

  if (compactable.length === 0) return false

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
    return false
  }

  const summaryContent = serializeContent(summaryResponse.message.content)
  const summaryText = `[Context Summary]\n${summaryContent}`

  let recentStart = 0
  const userIdx = pinned.findLastIndex(m => m.role === 'user')
  if (userIdx >= 0) {
    let extraText = summaryText
    let nonTextParts: ContentPart[] = []

    if (recent.length > 0 && recent[0]!.role === 'user') {
      const recentMsg = recent[0]!
      if (typeof recentMsg.content === 'string') {
        extraText += `\n\n${recentMsg.content}`
      } else {
        const text = recentMsg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('\n')
        if (text) extraText += `\n\n${text}`
        nonTextParts = recentMsg.content.filter(p => p.type !== 'text')
      }
      recentStart = 1
    }

    pinned[userIdx] = appendToMessage(pinned[userIdx]!, extraText, nonTextParts)
  }
  const originalCount = messages.length
  ctx.request.messages.length = 0
  ctx.request.messages.push(...pinned, ...recent.slice(recentStart))
  config.onCompact?.({
    originalMessages: originalCount,
    compactedMessages: ctx.request.messages.length,
    estimatedTokens: ctx.loop.lastUsage?.inputTokens ?? estimateTokens(messages),
    threshold: config.maxTokens ?? Math.floor(contextWindow * config.threshold),
  })
  return true
}

export function createCompactionMiddleware(
  provider: IProvider,
  config: CompactionConfig,
): Middleware<ModelCallContext> {
  return async (ctx: ModelCallContext) => {
    if (!config.enabled) return
    await _runCompaction(provider, config, ctx, false)
  }
}
