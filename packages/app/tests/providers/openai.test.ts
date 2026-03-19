import { describe, it, expect, mock } from 'bun:test'

mock.module('openai', () => {
  class MockOpenAI {
    responses = { create: async () => ({}) }
    chat = { completions: { create: async () => ({}) } }
  }
  return { default: MockOpenAI, AzureOpenAI: MockOpenAI }
})

const { OpenAIProvider, OpenAICompletionsProvider, OpenAIResponsesProvider } = await import('@chinmaymk/ra')

describe('openai barrel re-exports', () => {
  it('OpenAIProvider is OpenAIResponsesProvider', () => {
    expect(OpenAIProvider).toBe(OpenAIResponsesProvider)
  })

  it('OpenAIProvider (responses) defaults to name openai', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    expect(provider.name).toBe('openai')
  })

  it('OpenAICompletionsProvider defaults to name openai-completions', () => {
    const provider = new OpenAICompletionsProvider({ apiKey: 'test' })
    expect(provider.name).toBe('openai-completions')
  })
})
