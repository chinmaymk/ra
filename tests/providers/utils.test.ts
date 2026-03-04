import { describe, it, expect } from 'bun:test'
import { extractSystemMessages } from '../../src/providers/utils'

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
