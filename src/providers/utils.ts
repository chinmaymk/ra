import type { ContentPart, IMessage, TokenUsage } from './types'

/** Thinking budget tokens for Anthropic-compatible providers (Anthropic, Bedrock) */
export const THINKING_BUDGETS = { low: 1000, medium: 8000, high: 32000 } as const

/** Accumulate source token usage into target (mutates target) */
export function accumulateUsage(target: TokenUsage, source: TokenUsage): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  if (source.thinkingTokens) {
    target.thinkingTokens = (target.thinkingTokens ?? 0) + source.thinkingTokens
  }
}

/** Extract text from string or ContentPart[] content */
export function contentToString(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('')
}

/** Stringify content for tool results and serialization */
export function contentToJson(content: string | ContentPart[]): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

/** Extract error message from unknown error */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Parse JSON tool arguments with fallback to empty object */
export function parseToolArguments(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args !== 'string') return args
  try { return JSON.parse(args) } catch { return {} }
}

export function extractSystemMessages(messages: IMessage[]): { system: string | undefined; filtered: IMessage[] } {
  const systemParts: string[] = []
  const filtered: IMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(contentToString(msg.content))
    } else {
      filtered.push(msg)
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    filtered,
  }
}
