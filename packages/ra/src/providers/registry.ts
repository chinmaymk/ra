import type { IProvider, ProviderName } from './types'
import { AnthropicProvider, type AnthropicProviderOptions } from './anthropic'
import { OpenAIProvider, OpenAICompletionsProvider, type OpenAIProviderOptions } from './openai'
import { GoogleProvider, type GoogleProviderOptions } from './google'
import { OllamaProvider, type OllamaProviderOptions } from './ollama'
import { BedrockProvider, type BedrockProviderOptions } from './bedrock'
import { AzureProvider, type AzureProviderOptions } from './azure'
import { AgentSdkProvider, type AgentSdkProviderOptions } from './agent-sdk'

type ProviderOptionsMap = {
  anthropic: AnthropicProviderOptions
  openai: OpenAIProviderOptions
  'openai-completions': OpenAIProviderOptions
  google: GoogleProviderOptions
  ollama: OllamaProviderOptions
  bedrock: BedrockProviderOptions
  azure: AzureProviderOptions
  'agent-sdk': AgentSdkProviderOptions
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
  'openai-completions': OpenAICompletionsProvider,
  google: GoogleProvider,
  ollama: OllamaProvider,
  bedrock: BedrockProvider,
  azure: AzureProvider,
  'agent-sdk': AgentSdkProvider,
} as const

export function createProvider(config: ProviderConfig): IProvider {
  const { provider, ...opts } = config
  const Ctor = constructors[provider]
  return new (Ctor as new (opts: Record<string, unknown>) => IProvider)(opts)
}
