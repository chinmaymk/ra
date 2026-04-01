import { describe, it, expect } from 'bun:test'
import { extractSystemMessages, mergeConsecutiveRoles, accumulateUsage, cacheHitPercent, extractTextContent, serializeContent, parseToolArguments, resolveThinkingBudget, THINKING_BUDGETS, pricingForModel, estimateUsageCost, formatUsd } from '@chinmaymk/ra'
import type { TokenUsage, ContentPart, ModelPricing, UsageCostEstimate } from '@chinmaymk/ra'

describe('mergeConsecutiveRoles', () => {
  it('returns empty array for empty input', () => {
    expect(mergeConsecutiveRoles([])).toEqual([])
  })

  it('does not merge messages with alternating roles', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'bye' },
    ]
    const merged = mergeConsecutiveRoles(messages)
    expect(merged).toHaveLength(3)
  })

  it('merges consecutive same-role messages with array content', () => {
    const messages = [
      { role: 'user', content: [{ type: 'tool_result', data: 'x' }] },
      { role: 'user', content: 'follow up' },
    ]
    const merged = mergeConsecutiveRoles(messages)
    expect(merged).toHaveLength(1)
    expect(merged[0]!.role).toBe('user')
    const content = merged[0]!.content as any[]
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'tool_result', data: 'x' })
    expect(content[1]).toEqual({ type: 'text', text: 'follow up' })
  })

  it('does not mutate the original messages', () => {
    const messages = [
      { role: 'user', content: [{ type: 'a' }] },
      { role: 'user', content: [{ type: 'b' }] },
    ]
    mergeConsecutiveRoles(messages)
    expect((messages[0]!.content as any[]).length).toBe(1)
  })

  it('merges three consecutive user messages into one', () => {
    const messages = [
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
      { role: 'user', content: 'c' },
    ]
    const merged = mergeConsecutiveRoles(messages)
    expect(merged).toHaveLength(1)
    const content = merged[0]!.content as unknown as unknown[]
    expect(content).toHaveLength(3)
  })

  it('single message returns unchanged', () => {
    const messages = [{ role: 'user', content: 'solo' }]
    const merged = mergeConsecutiveRoles(messages)
    expect(merged).toHaveLength(1)
  })

  it('preserves original array length (middleware sees unmerged messages)', () => {
    // This verifies that provider-level merging doesn't affect middleware's view.
    // Middleware injects user messages (memory, scratchpad) that create consecutive
    // user messages. The provider merges these for the API call, but the original
    // IMessage[] array used by middleware must remain untouched.
    const original = [
      { role: 'user', content: 'First user message' },
      { role: 'user', content: '<recalled-memories>\nSome memory\n</recalled-memories>' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: '<scratchpad>\n### plan\ndo stuff\n</scratchpad>' },
      { role: 'user', content: 'Latest user message' },
    ]
    const originalLength = original.length
    const originalContents = original.map(m => m.content)

    const merged = mergeConsecutiveRoles(original)

    // Merged result should combine consecutive user messages
    expect(merged.length).toBeLessThan(originalLength)

    // But the original array must be completely unchanged
    expect(original).toHaveLength(originalLength)
    original.forEach((msg, i) => {
      expect(msg.content).toBe(originalContents[i]!)
    })
  })
})

describe('extractSystemMessages', () => {
  it('extracts string system messages', () => {
    const { system, filtered } = extractSystemMessages([
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'hi' },
    ])
    expect(system).toBe('Be helpful')
    expect(filtered).toHaveLength(1)
  })

  it('extracts system messages with ContentPart[] content', () => {
    const { system } = extractSystemMessages([
      { role: 'system', content: [{ type: 'text' as const, text: 'Be helpful' }, { type: 'text' as const, text: ' and concise' }] },
      { role: 'user', content: 'hi' },
    ])
    expect(system).toBe('Be helpful and concise')
  })

  it('returns undefined system when no system messages', () => {
    const { system } = extractSystemMessages([
      { role: 'user', content: 'hi' },
    ])
    expect(system).toBeUndefined()
  })

  it('joins multiple system messages with newline', () => {
    const { system } = extractSystemMessages([
      { role: 'system', content: 'Rule 1' },
      { role: 'user', content: 'hi' },
      { role: 'system', content: 'Rule 2' },
    ])
    expect(system).toBe('Rule 1\nRule 2')
  })
})

describe('accumulateUsage', () => {
  it('adds input and output tokens', () => {
    const target: TokenUsage = { inputTokens: 10, outputTokens: 5 }
    accumulateUsage(target, { inputTokens: 20, outputTokens: 10 })
    expect(target).toEqual({ inputTokens: 30, outputTokens: 15 })
  })

  it('adds thinkingTokens when source has it but target does not', () => {
    const target: TokenUsage = { inputTokens: 10, outputTokens: 5 }
    accumulateUsage(target, { inputTokens: 1, outputTokens: 1, thinkingTokens: 100 })
    expect(target.thinkingTokens).toBe(100)
  })

  it('accumulates thinkingTokens when both have it', () => {
    const target: TokenUsage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 50 }
    accumulateUsage(target, { inputTokens: 0, outputTokens: 0, thinkingTokens: 30 })
    expect(target.thinkingTokens).toBe(80)
  })

  it('does not set thinkingTokens when source lacks it', () => {
    const target: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    accumulateUsage(target, { inputTokens: 1, outputTokens: 1 })
    expect(target.thinkingTokens).toBeUndefined()
  })

  it('accumulates cacheReadTokens when source has it', () => {
    const target: TokenUsage = { inputTokens: 10, outputTokens: 5 }
    accumulateUsage(target, { inputTokens: 20, outputTokens: 10, cacheReadTokens: 15 })
    expect(target.cacheReadTokens).toBe(15)
  })

  it('accumulates cacheCreationTokens when source has it', () => {
    const target: TokenUsage = { inputTokens: 10, outputTokens: 5 }
    accumulateUsage(target, { inputTokens: 20, outputTokens: 10, cacheCreationTokens: 8 })
    expect(target.cacheCreationTokens).toBe(8)
  })

  it('accumulates cache tokens across multiple calls', () => {
    const target: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 10 }
    accumulateUsage(target, { inputTokens: 5, outputTokens: 5, cacheReadTokens: 20, cacheCreationTokens: 3 })
    expect(target.cacheReadTokens).toBe(30)
    expect(target.cacheCreationTokens).toBe(3)
  })

  it('does not set cache tokens when source lacks them', () => {
    const target: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    accumulateUsage(target, { inputTokens: 1, outputTokens: 1 })
    expect(target.cacheReadTokens).toBeUndefined()
    expect(target.cacheCreationTokens).toBeUndefined()
  })
})

describe('cacheHitPercent', () => {
  it('returns percentage with one decimal place', () => {
    expect(cacheHitPercent(100, 80)).toBe(80)
    expect(cacheHitPercent(200, 150)).toBe(75)
    expect(cacheHitPercent(300, 100)).toBe(33.3)
  })

  it('returns null when no cache reads', () => {
    expect(cacheHitPercent(100, 0)).toBeNull()
    expect(cacheHitPercent(100, undefined)).toBeNull()
  })

  it('returns null when input is zero', () => {
    expect(cacheHitPercent(0, 50)).toBeNull()
  })
})

describe('extractTextContent', () => {
  it('returns string content as-is', () => {
    expect(extractTextContent('hello world')).toBe('hello world')
  })

  it('joins text parts from ContentPart array', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
    ]
    expect(extractTextContent(parts)).toBe('Hello world')
  })

  it('filters out non-text parts', () => {
    const parts: ContentPart[] = [
      { type: 'text', text: 'before' },
      { type: 'image', source: { type: 'url', url: 'http://img' } } as ContentPart,
      { type: 'text', text: 'after' },
    ]
    expect(extractTextContent(parts)).toBe('beforeafter')
  })

  it('returns empty string for empty array', () => {
    expect(extractTextContent([])).toBe('')
  })
})

describe('serializeContent', () => {
  it('returns string content as-is', () => {
    expect(serializeContent('hello')).toBe('hello')
  })

  it('JSON-stringifies ContentPart array', () => {
    const parts: ContentPart[] = [{ type: 'text', text: 'hi' }]
    expect(serializeContent(parts)).toBe(JSON.stringify(parts))
  })
})

describe('parseToolArguments', () => {
  it('parses valid JSON string', () => {
    expect(parseToolArguments('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('returns {} for malformed JSON', () => {
    expect(parseToolArguments('{bad json')).toEqual({})
  })

  it('returns object input as-is', () => {
    const obj = { a: 1, b: 'two' }
    expect(parseToolArguments(obj)).toBe(obj)
  })

  it('returns {} for empty string', () => {
    expect(parseToolArguments('')).toEqual({})
  })
})

describe('resolveThinkingBudget', () => {
  it('returns level budget when no cap', () => {
    expect(resolveThinkingBudget(THINKING_BUDGETS, 'high')).toBe(32000)
    expect(resolveThinkingBudget(THINKING_BUDGETS, 'low')).toBe(1024)
  })

  it('caps budget when cap is lower than level budget', () => {
    expect(resolveThinkingBudget(THINKING_BUDGETS, 'high', 5000)).toBe(5000)
  })

  it('uses level budget when cap is higher', () => {
    expect(resolveThinkingBudget(THINKING_BUDGETS, 'low', 50000)).toBe(1024)
  })

  it('falls back to 1024 for unknown level', () => {
    expect(resolveThinkingBudget(THINKING_BUDGETS, 'unknown')).toBe(1024)
  })
})

describe('pricingForModel', () => {
  it('returns pricing for Anthropic models', () => {
    const opus = pricingForModel('claude-opus-4-6')
    expect(opus).toBeDefined()
    expect(opus!.inputCostPerMillion).toBe(15)
    expect(opus!.outputCostPerMillion).toBe(75)

    const sonnet = pricingForModel('claude-sonnet-4-6')
    expect(sonnet).toBeDefined()
    expect(sonnet!.inputCostPerMillion).toBe(3)

    const haiku = pricingForModel('claude-haiku-4-5-20251001')
    expect(haiku).toBeDefined()
    expect(haiku!.inputCostPerMillion).toBe(0.8)
  })

  it('returns pricing for OpenAI models', () => {
    const gpt4o = pricingForModel('gpt-4o-2024-08-06')
    expect(gpt4o).toBeDefined()
    expect(gpt4o!.inputCostPerMillion).toBe(2.5)
  })

  it('returns pricing for Google models', () => {
    const gemini = pricingForModel('gemini-2.5-pro-latest')
    expect(gemini).toBeDefined()
    expect(gemini!.inputCostPerMillion).toBe(1.25)
  })

  it('returns undefined for unknown models', () => {
    expect(pricingForModel('custom-llama-7b')).toBeUndefined()
  })
})

describe('estimateUsageCost', () => {
  it('estimates cost for known model', () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 500_000 }
    const cost = estimateUsageCost(usage, 'claude-opus-4-6')
    expect(cost.inputCostUsd).toBe(15)
    expect(cost.outputCostUsd).toBe(37.5)
    expect(cost.totalCostUsd).toBe(52.5)
  })

  it('includes cache costs when present', () => {
    const usage: TokenUsage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheCreationTokens: 10_000,
      cacheReadTokens: 20_000,
    }
    const cost = estimateUsageCost(usage, 'claude-sonnet-4-6')
    expect(cost.cacheCreationCostUsd).toBeGreaterThan(0)
    expect(cost.cacheReadCostUsd).toBeGreaterThan(0)
    expect(cost.totalCostUsd).toBe(
      cost.inputCostUsd + cost.outputCostUsd + cost.cacheCreationCostUsd + cost.cacheReadCostUsd
    )
  })

  it('uses default pricing for unknown models', () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const cost = estimateUsageCost(usage, 'unknown-model')
    // Default falls back to sonnet-tier pricing
    expect(cost.inputCostUsd).toBe(3)
    expect(cost.outputCostUsd).toBe(15)
  })

  it('works without model parameter', () => {
    const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }
    const cost = estimateUsageCost(usage)
    expect(cost.totalCostUsd).toBeGreaterThan(0)
  })

  it('returns zero costs for zero usage', () => {
    const cost = estimateUsageCost({ inputTokens: 0, outputTokens: 0 })
    expect(cost.totalCostUsd).toBe(0)
  })
})

describe('formatUsd', () => {
  it('formats to 4 decimal places', () => {
    expect(formatUsd(15)).toBe('$15.0000')
    expect(formatUsd(0.001)).toBe('$0.0010')
    expect(formatUsd(0)).toBe('$0.0000')
  })
})
