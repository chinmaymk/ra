import { describe, it, expect } from 'bun:test'
import { extractSystemMessages, mergeConsecutiveRoles, accumulateUsage, extractTextContent, serializeContent, parseToolArguments } from '@chinmaymk/ra'
import type { TokenUsage, ContentPart } from '@chinmaymk/ra'

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
