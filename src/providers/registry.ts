import type { IProvider } from './types'
import type { ProviderName } from '../config/types'
import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic'
import { OpenAIProvider, type OpenAIProviderOptions } from './openai'
import { GoogleProvider, type GoogleProviderOptions } from './google'
import { OllamaProvider, type OllamaProviderOptions } from './ollama'
import { BedrockProvider, type BedrockProviderOptions } from './bedrock'

type ProviderOptionsMap = {
  anthropic: AnthropicProviderOptions
  openai: OpenAIProviderOptions
  google: GoogleProviderOptions
  ollama: OllamaProviderOptions
  bedrock: BedrockProviderOptions
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

export function createProvider(config: ProviderConfig): IProvider {
  switch (config.provider) {
    case 'anthropic': {
      const { provider: _, ...opts } = config
      return new AnthropicProvider(opts)
    }
    case 'openai': {
      const { provider: _, ...opts } = config
      return new OpenAIProvider(opts)
    }
    case 'google': {
      const { provider: _, ...opts } = config
      return new GoogleProvider(opts)
    }
    case 'ollama': {
      const { provider: _, ...opts } = config
      return new OllamaProvider(opts)
    }
    case 'bedrock': {
      const { provider: _, ...opts } = config
      return new BedrockProvider(opts)
    }
  }
}
