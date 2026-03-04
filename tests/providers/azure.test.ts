import { describe, it, expect } from 'bun:test'
import { AzureProvider } from '../../src/providers/azure'

describe('AzureProvider', () => {
  it('has name azure', () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'gpt-4o', apiVersion: '2024-02-01' })
    expect(p.name).toBe('azure')
  })

  it('uses deployment as model in buildParams', () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'my-gpt4o', apiVersion: '2024-02-01' })
    const params = (p as any).buildParams({
      model: 'should-be-ignored',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(params.model).toBe('my-gpt4o')
  })

  it('constructs with apiKey auth', () => {
    const p = new AzureProvider({
      endpoint: 'https://test.openai.azure.com/',
      deployment: 'gpt-4o',
      apiKey: 'test-key',
      apiVersion: '2024-02-01',
    })
    expect(p.name).toBe('azure')
  })

  it('constructs with DefaultAzureCredential when no apiKey', () => {
    const p = new AzureProvider({ endpoint: 'https://test.openai.azure.com/', deployment: 'gpt-4o', apiVersion: '2024-02-01' })
    expect(p.name).toBe('azure')
  })
})
