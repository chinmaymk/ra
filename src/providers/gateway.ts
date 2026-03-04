import { OpenAIProvider } from './openai'
import type { IProvider } from './types'

export interface GatewayProviderOptions {
  /** Gateway base URL (e.g. https://ai-gateway.tailscale.net/v1) */
  url: string
  /** API key for authenticating with the gateway */
  apiKey?: string
  /** Custom headers sent with every request (for auth tokens, routing, etc.) */
  headers?: Record<string, string>
}

/**
 * Gateway provider for OpenAI-compatible AI gateways.
 *
 * Works with:
 *   - Tailscale Aperture (ai-gateway.tailscale.net)
 *   - Databricks Model Serving / AI Gateway
 *   - LiteLLM proxy
 *   - Any OpenAI-compatible proxy
 *
 * The gateway receives standard OpenAI chat completion requests and routes
 * them to the appropriate backend model based on the model name.
 */
export class GatewayProvider extends OpenAIProvider implements IProvider {
  override name = 'gateway'

  constructor(options: GatewayProviderOptions) {
    super({
      apiKey: options.apiKey ?? 'gateway',
      baseURL: options.url,
      headers: options.headers,
    })
  }
}
