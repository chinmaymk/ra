import { describe, it, expect } from 'bun:test'
import { estimateTokens } from '@chinmaymk/ra'
import type { IMessage } from '@chinmaymk/ra'

describe('estimateTokens', () => {
  it('estimates string content as strlen/4', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'abcd' },
    ]
    expect(estimateTokens(messages)).toBe(1)
  })

  it('estimates multi-part content via JSON serialization', () => {
    const messages: IMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ]
    const result = estimateTokens(messages)
    expect(result).toBeGreaterThan(0)
  })

  it('includes toolCalls in estimation', () => {
    const withoutTools: IMessage[] = [
      { role: 'assistant', content: 'hi' },
    ]
    const withTools: IMessage[] = [
      { role: 'assistant', content: 'hi', toolCalls: [{ id: 'tc1', name: 'Read', arguments: '{"path":"/foo/bar"}' }] },
    ]
    expect(estimateTokens(withTools)).toBeGreaterThan(estimateTokens(withoutTools))
  })

  it('sums across multiple messages', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'abcd' },
      { role: 'assistant', content: 'abcd' },
    ]
    expect(estimateTokens(messages)).toBe(2)
  })

  it('rounds up partial tokens', () => {
    const messages: IMessage[] = [
      { role: 'user', content: 'ab' },
    ]
    expect(estimateTokens(messages)).toBe(1)
  })

  it('returns 0 for empty messages', () => {
    expect(estimateTokens([])).toBe(0)
  })
})
