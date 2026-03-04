import { describe, it, expect } from 'bun:test'
import { createProvider, buildProviderConfig } from '../../src/providers/registry'
import { AzureProvider } from '../../src/providers/azure'

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
})
