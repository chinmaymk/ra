import { describe, it, expect } from 'bun:test'
import { getContextWindowSize, getDefaultCompactionModel, setLearnedContextWindow } from '@chinmaymk/ra'

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
    expect(getContextWindowSize('some-unknown-model')).toBe(200_000)
  })

  it('accepts user override', () => {
    expect(getContextWindowSize('some-unknown-model', 64_000)).toBe(64_000)
  })

  it('user override takes priority over family match', () => {
    expect(getContextWindowSize('claude-sonnet-4-6', 50_000)).toBe(50_000)
  })

  it('uses learned context window for unknown models', () => {
    setLearnedContextWindow('my-custom-model-v1', 32_000)
    expect(getContextWindowSize('my-custom-model-v1')).toBe(32_000)
  })

  it('user override takes priority over learned value', () => {
    setLearnedContextWindow('my-custom-model-v3', 32_000)
    expect(getContextWindowSize('my-custom-model-v3', 64_000)).toBe(64_000)
  })

  it('learned value takes priority over registry for known model prefix', () => {
    // If a model like claude-sonnet-custom has a different real window, learned wins
    setLearnedContextWindow('claude-sonnet-custom', 100_000)
    expect(getContextWindowSize('claude-sonnet-custom')).toBe(100_000)
  })

  it('empty model name returns default', () => {
    expect(getContextWindowSize('')).toBe(200_000)
  })

  it('distinguishes gpt-4o from gpt-4 (longest prefix match)', () => {
    expect(getContextWindowSize('gpt-4o')).toBe(128_000)
    expect(getContextWindowSize('gpt-4')).toBe(8_192)
  })

  it('o1 and o3 families resolve correctly', () => {
    expect(getContextWindowSize('o1-preview')).toBe(200_000)
    expect(getContextWindowSize('o3-mini')).toBe(200_000)
  })

  it('gpt-3.5-turbo resolves to 16k', () => {
    expect(getContextWindowSize('gpt-3.5-turbo')).toBe(16_385)
  })
})

describe('getDefaultCompactionModel', () => {
  it('returns correct model for each provider', () => {
    expect(getDefaultCompactionModel('anthropic')).toBe('claude-haiku-4-5-20251001')
    expect(getDefaultCompactionModel('openai')).toBe('gpt-4o-mini')
    expect(getDefaultCompactionModel('google')).toBe('gemini-2.0-flash')
    expect(getDefaultCompactionModel('azure')).toBe('gpt-4o-mini')
  })

  it('returns empty string for ollama', () => {
    expect(getDefaultCompactionModel('ollama')).toBe('')
  })

  it('returns empty string for unknown provider', () => {
    expect(getDefaultCompactionModel('nonexistent')).toBe('')
  })
})
