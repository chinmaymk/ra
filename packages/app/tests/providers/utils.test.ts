import { describe, it, expect } from 'bun:test'
import { extractSystemMessages, mergeConsecutiveRoles } from '@chinmaymk/ra'

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
})
