import { describe, it, expect } from 'bun:test'
import { getContextWindowSize } from '@chinmaymk/ra'

describe('getContextWindowSize', () => {
  it('resolves exact family prefix', () => {
    expect(getContextWindowSize('claude-sonnet-4-6')).toBe(200_000)
  })

  it('resolves gpt-4o family', () => {
    expect(getContextWindowSize('gpt-4o-mini')).toBe(128_000)
  })

  it('resolves gemini family', () => {
    expect(getContextWindowSize('gemini-2.0-flash')).toBe(1_048_576)
  })

  it('uses longest prefix match', () => {
    expect(getContextWindowSize('gpt-4-turbo-preview')).toBe(128_000)
    expect(getContextWindowSize('gpt-4-0613')).toBe(8_192)
  })

  it('returns fallback for unknown model', () => {
    expect(getContextWindowSize('some-unknown-model')).toBe(128_000)
  })

  it('accepts user override', () => {
    expect(getContextWindowSize('some-unknown-model', 64_000)).toBe(64_000)
  })

  it('user override takes priority over family match', () => {
    expect(getContextWindowSize('claude-sonnet-4-6', 50_000)).toBe(50_000)
  })
})
