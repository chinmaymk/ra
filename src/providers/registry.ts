import type { IProvider } from './types'
import type { ProviderName } from '../config/types'
import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic'
import { OpenAIProvider, type OpenAIProviderOptions } from './openai'
import { GoogleProvider, type GoogleProviderOptions } from './google'
import { OllamaProvider, type OllamaProviderOptions } from './ollama'
import { BedrockProvider, type BedrockProviderOptions } from './bedrock'
import { AzureProvider, type AzureProviderOptions } from './azure'

type ProviderOptionsMap = {
  anthropic: AnthropicProviderOptions
  openai: OpenAIProviderOptions
  google: GoogleProviderOptions
  ollama: OllamaProviderOptions
  bedrock: BedrockProviderOptions
  azure: AzureProviderOptions
}

export type ProviderConfig = {
  [K in ProviderName]: { provider: K } & ProviderOptionsMap[K]
}[ProviderName]

export function buildProviderConfig<N extends ProviderName>(
  name: N,
  opts: ProviderOptionsMap[N],
): ProviderConfig {
  return { provider: name, ...opts } as ProviderConfig
}

const constructors = {
  anthropic: AnthropicProvider,
  openai: OpenAIProvider,
  google: GoogleProvider,
  ollama: OllamaProvider,
  bedrock: BedrockProvider,
  azure: AzureProvider,
} as const

export function createProvider(config: ProviderConfig): IProvider {
  const { provider, ...opts } = config
  const Ctor = constructors[provider]
  return new (Ctor as new (opts: Record<string, unknown>) => IProvider)(opts)
}
