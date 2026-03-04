import { describe, it, expect } from 'bun:test'
import { createProvider } from '../../src/providers/registry'

describe('createProvider', () => {
  it('creates anthropic provider', () => {
    const p = createProvider({ provider: 'anthropic', apiKey: 'test' })
    expect(p.name).toBe('anthropic')
  })
  it('creates openai provider', () => {
    const p = createProvider({ provider: 'openai', apiKey: 'test' })
    expect(p.name).toBe('openai')
  })
  it('creates google provider', () => {
    const p = createProvider({ provider: 'google', apiKey: 'test' })
    expect(p.name).toBe('google')
  })
  it('creates ollama provider', () => {
    const p = createProvider({ provider: 'ollama', host: 'http://localhost:11434' })
    expect(p.name).toBe('ollama')
  })
  it('creates bedrock provider', () => {
    const p = createProvider({ provider: 'bedrock', region: 'us-east-1' })
    expect(p.name).toBe('bedrock')
  })
})
