import type { IMessage, TokenUsage } from './types'

/**
 * Merge consecutive messages with the same role into a single message.
 * Required for APIs that enforce alternating user/assistant turns (Anthropic, Google, Bedrock).
 * This happens after ask_user: tool result (mapped to user) is followed by the next user message.
 */
export function mergeConsecutiveRoles<T extends { role: string; content: unknown }>(messages: T[]): T[] {
  const merged: T[] = []
  for (const msg of messages) {
    const last = merged[merged.length - 1]
    if (last && last.role === msg.role) {
      const lastContent = Array.isArray(last.content) ? last.content : [typeof last.content === 'string' ? { type: 'text', text: last.content } : last.content]
      const msgContent = Array.isArray(msg.content) ? msg.content : [typeof msg.content === 'string' ? { type: 'text', text: msg.content } : msg.content]
      last.content = [...lastContent, ...msgContent] as T['content']
    } else {
      merged.push({ ...msg })
    }
  }
  return merged
}

/** Accumulate source token usage into target (mutates target) */
export function accumulateUsage(target: TokenUsage, source: TokenUsage): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  if (source.thinkingTokens) {
    target.thinkingTokens = (target.thinkingTokens ?? 0) + source.thinkingTokens
  }
}

export function extractSystemMessages(messages: IMessage[]): { system: string | undefined; filtered: IMessage[] } {
  const systemParts: string[] = []
  const filtered: IMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join(''))
    } else {
      filtered.push(msg)
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    filtered,
  }
}
