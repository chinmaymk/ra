import { describe, it, expect } from 'bun:test'
import { createProvider, buildProviderConfig, AzureProvider, AnthropicAgentsSdkProvider } from '@chinmaymk/ra'

describe('createProvider', () => {
  it('creates AzureProvider for azure', () => {
    const config = buildProviderConfig('azure', {
      endpoint: 'https://test.openai.azure.com/',
      deployment: 'gpt-4o',
      apiVersion: '2024-02-01',
    })
    const provider = createProvider(config)
    expect(provider).toBeInstanceOf(AzureProvider)
    expect(provider.name).toBe('azure')
  })

  it('creates AnthropicAgentsSdkProvider for anthropic-agents-sdk', () => {
    const config = buildProviderConfig('anthropic-agents-sdk', {})
    const provider = createProvider(config)
    expect(provider).toBeInstanceOf(AnthropicAgentsSdkProvider)
    expect(provider.name).toBe('anthropic-agents-sdk')
  })
})
