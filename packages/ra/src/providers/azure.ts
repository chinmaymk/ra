import OpenAI, { AzureOpenAI } from 'openai'
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity'
import { OpenAIResponsesProvider } from './openai-responses'
import type { ChatRequest } from './types'

export interface AzureProviderOptions {
  endpoint: string
  deployment: string
  apiKey?: string
  apiVersion?: string
}

export class AzureProvider extends OpenAIResponsesProvider {
  override name = 'azure'
  private deployment: string

  constructor(options: AzureProviderOptions) {
    super({ apiKey: '' })
    this.deployment = options.deployment

    const baseConfig = {
      endpoint: options.endpoint,
      deployment: options.deployment,
      apiVersion: options.apiVersion,
    }

    if (options.apiKey) {
      this.client = new AzureOpenAI({ ...baseConfig, apiKey: options.apiKey }) as unknown as OpenAI
    } else {
      const credential = new DefaultAzureCredential()
      const azureADTokenProvider = getBearerTokenProvider(credential, 'https://cognitiveservices.azure.com/.default')
      this.client = new AzureOpenAI({ ...baseConfig, azureADTokenProvider }) as unknown as OpenAI
    }
  }

  override buildParams(request: ChatRequest) {
    return { ...super.buildParams(request), model: this.deployment }
  }
}
