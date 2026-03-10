import type { IMessage, TokenUsage } from './types'

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
