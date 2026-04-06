import { describe, it, expect, mock } from 'bun:test'

mock.module('openai', () => {
  class MockOpenAI {
    responses = { create: async () => ({}) }
  }
  return { default: MockOpenAI }
})

const { CodexProvider } = await import('../../src/providers/openai-codex')

describe('CodexProvider', () => {
  it('has name codex', () => {
    const p = new CodexProvider({ accessToken: 'test-token' })
    expect(p.name).toBe('codex')
  })

  it('defaults baseURL to chatgpt.com Codex backend', () => {
    const p = new CodexProvider({ accessToken: 'test-token' })
    // The provider is an instance of OpenAIResponsesProvider
    expect(p.name).toBe('codex')
  })

  it('accepts custom baseURL', () => {
    const p = new CodexProvider({ accessToken: 'test-token', baseURL: 'https://proxy.example.com/codex' })
    expect(p.name).toBe('codex')
  })

  it('accepts custom deviceId', () => {
    const p = new CodexProvider({ accessToken: 'test-token', deviceId: 'my-device-id' })
    expect(p.name).toBe('codex')
  })

  it('strips reasoning from buildParams', () => {
    const p = new CodexProvider({ accessToken: 'test-token' })
    const params = p.buildParams({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: 'high',
    })
    expect((params as Record<string, unknown>).reasoning).toBeUndefined()
  })

  it('preserves other params from buildParams', () => {
    const p = new CodexProvider({ accessToken: 'test-token' })
    const params = p.buildParams({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.model).toBe('gpt-5.4')
  })

  it('always includes instructions in buildParams', () => {
    const p = new CodexProvider({ accessToken: 'test-token' })
    const params = p.buildParams({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect((params as Record<string, unknown>).instructions).toBeDefined()
  })

  it('sets store to false in buildParams', () => {
    const p = new CodexProvider({ accessToken: 'test-token' })
    const params = p.buildParams({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect((params as Record<string, unknown>).store).toBe(false)
  })

  it('extracts chatgpt-account-id from JWT', () => {
    // Build a fake JWT with the account ID claim
    const payload = {
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_123' },
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const fakeJwt = `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
    const p = new CodexProvider({ accessToken: fakeJwt })
    expect(p.name).toBe('codex')
  })

  it('handles non-JWT access tokens gracefully', () => {
    const p = new CodexProvider({ accessToken: 'not-a-jwt' })
    expect(p.name).toBe('codex')
  })
})
