import type { IMessage, TokenUsage, ContentPart } from './types'

/**
 * Merge consecutive messages with the same role using a caller-supplied merge function.
 * Required for APIs that enforce alternating user/assistant turns (Anthropic, Google, Bedrock).
 * Consecutive same-role messages can occur when skill XML and the user message are both injected
 * as user-role messages, or when context files precede the user turn.
 */
export function mergeConsecutive<T extends { role?: string }>(items: T[], merge: (into: T, from: T) => void): T[] {
  const result: T[] = []
  for (const item of items) {
    const last = result[result.length - 1]
    if (last && item.role && last.role === item.role) {
      merge(last, item)
    } else {
      result.push({ ...item })
    }
  }
  return result
}

/** Merge consecutive IMessages — normalises string content to text parts before joining. */
export function mergeConsecutiveRoles<T extends { role: string; content: unknown }>(messages: T[]): T[] {
  const toArray = (content: unknown) =>
    Array.isArray(content) ? content : [typeof content === 'string' ? { type: 'text', text: content } : content]
  return mergeConsecutive(messages, (a, b) => {
    a.content = toArray(a.content).concat(toArray(b.content)) as T['content']
  })
}

/** Accumulate source token usage into target (mutates target) */
export function accumulateUsage(target: TokenUsage, source: TokenUsage): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  if (source.thinkingTokens) {
    target.thinkingTokens = (target.thinkingTokens ?? 0) + source.thinkingTokens
  }
}

/** Extract text from string or ContentPart[] content. */
export function extractTextContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
}

/** Serialize message content to string for tool results. */
export function serializeContent(content: string | ContentPart[]): string {
  return typeof content === 'string' ? content : JSON.stringify(content)
}

/** Minimum thinking budget per Anthropic API. */
const MIN_THINKING_BUDGET = 1024

/** Thinking budget tokens shared by Anthropic and Bedrock providers. */
export const THINKING_BUDGETS = { low: 1024, medium: 16000, high: 32000 } as const

/** Resolve the effective thinking budget, applying an optional cap. */
export function resolveThinkingBudget(budgets: Record<string, number>, level: string, cap?: number): number {
  const base = budgets[level] ?? MIN_THINKING_BUDGET
  return cap ? Math.min(base, cap) : base
}

/** Default max output tokens for providers that require an explicit limit (Anthropic, Bedrock). */
export const DEFAULT_MAX_TOKENS = 4096

/** Parse tool call arguments from string or object, returning {} on failure. */
export function parseToolArguments(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args !== 'string') return args
  try { return JSON.parse(args) } catch { return {} }
}

export function extractSystemMessages(messages: IMessage[]): { system: string | undefined; filtered: IMessage[] } {
  const systemParts: string[] = []
  const filtered: IMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(extractTextContent(msg.content))
    } else {
      filtered.push(msg)
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n') : undefined,
    filtered,
  }
}
