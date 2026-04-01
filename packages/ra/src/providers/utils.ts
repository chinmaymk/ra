import type { IMessage, TokenUsage, ContentPart, StreamChunk } from './types'

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
  if (source.cacheReadTokens) {
    target.cacheReadTokens = (target.cacheReadTokens ?? 0) + source.cacheReadTokens
  }
  if (source.cacheCreationTokens) {
    target.cacheCreationTokens = (target.cacheCreationTokens ?? 0) + source.cacheCreationTokens
  }
}

/** Compute cache hit percentage (one decimal place), or null if not applicable.
 * Expects inputTokens to be the total input (all providers normalise to this).
 */
export function cacheHitPercent(inputTokens: number, cacheReadTokens: number | undefined): number | null {
  return inputTokens > 0 && cacheReadTokens
    ? Math.round((cacheReadTokens / inputTokens) * 1000) / 10
    : null
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

// ── Cost estimation ────────────────────────────────────────────────

export interface ModelPricing {
  inputCostPerMillion: number
  outputCostPerMillion: number
  cacheCreationCostPerMillion?: number
  cacheReadCostPerMillion?: number
}

export interface UsageCostEstimate {
  inputCostUsd: number
  outputCostUsd: number
  cacheCreationCostUsd: number
  cacheReadCostUsd: number
  totalCostUsd: number
}

const MODEL_PRICING: [string, ModelPricing][] = [
  ['claude-opus', { inputCostPerMillion: 15, outputCostPerMillion: 75, cacheCreationCostPerMillion: 18.75, cacheReadCostPerMillion: 1.5 }],
  ['claude-sonnet', { inputCostPerMillion: 3, outputCostPerMillion: 15, cacheCreationCostPerMillion: 3.75, cacheReadCostPerMillion: 0.3 }],
  ['claude-haiku', { inputCostPerMillion: 0.8, outputCostPerMillion: 4, cacheCreationCostPerMillion: 1, cacheReadCostPerMillion: 0.08 }],
  ['gpt-4.1', { inputCostPerMillion: 2, outputCostPerMillion: 8 }],
  ['gpt-4o', { inputCostPerMillion: 2.5, outputCostPerMillion: 10 }],
  ['gpt-4o-mini', { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 }],
  ['o3', { inputCostPerMillion: 2, outputCostPerMillion: 8 }],
  ['o4-mini', { inputCostPerMillion: 1.1, outputCostPerMillion: 4.4 }],
  ['gemini-2.5-pro', { inputCostPerMillion: 1.25, outputCostPerMillion: 10 }],
  ['gemini-2.5-flash', { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 }],
]

/** Look up pricing for a model by prefix match. Returns undefined for unknown models. */
export function pricingForModel(model: string): ModelPricing | undefined {
  const normalized = model.toLowerCase()
  for (const [prefix, pricing] of MODEL_PRICING) {
    if (normalized.includes(prefix)) return pricing
  }
  return undefined
}

function costForTokens(tokens: number, usdPerMillion: number): number {
  return (tokens / 1_000_000) * usdPerMillion
}

/** Estimate the USD cost for a given token usage, using model-specific or default pricing. */
export function estimateUsageCost(usage: TokenUsage, model?: string): UsageCostEstimate {
  const pricing = model ? pricingForModel(model) : undefined
  const p = pricing ?? { inputCostPerMillion: 3, outputCostPerMillion: 15, cacheCreationCostPerMillion: 3.75, cacheReadCostPerMillion: 0.3 }
  const inputCostUsd = costForTokens(usage.inputTokens, p.inputCostPerMillion)
  const outputCostUsd = costForTokens(usage.outputTokens, p.outputCostPerMillion)
  const cacheCreationCostUsd = usage.cacheCreationTokens && p.cacheCreationCostPerMillion
    ? costForTokens(usage.cacheCreationTokens, p.cacheCreationCostPerMillion)
    : 0
  const cacheReadCostUsd = usage.cacheReadTokens && p.cacheReadCostPerMillion
    ? costForTokens(usage.cacheReadTokens, p.cacheReadCostPerMillion)
    : 0
  const totalCostUsd = inputCostUsd + outputCostUsd + cacheCreationCostUsd + cacheReadCostUsd
  return { inputCostUsd, outputCostUsd, cacheCreationCostUsd, cacheReadCostUsd, totalCostUsd }
}

/** Format a USD amount to 4 decimal places. */
export function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`
}

// ── Thinking budgets ───────────────────────────────────────────────

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

/**
 * Wraps an async iterable of StreamChunks to guarantee a `{ type: 'done' }` is always
 * yielded exactly once at the end, even if the underlying stream exits early.
 * Providers that emit 'done' themselves will have it forwarded and no duplicate emitted.
 */
export async function* withDoneGuard(stream: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk> {
  let emittedDone = false
  for await (const chunk of stream) {
    if (chunk.type === 'done') emittedDone = true
    yield chunk
  }
  if (!emittedDone) yield { type: 'done' }
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
