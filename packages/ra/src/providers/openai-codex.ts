import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { OpenAIResponsesProvider } from './openai-responses'
import type { ChatRequest } from './types'

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'

export interface CodexProviderOptions {
  /** OAuth access token from ChatGPT login. */
  accessToken: string
  /** Override the Codex backend URL (e.g. for proxies). */
  baseURL?: string
  /** Device ID sent as oai-device-id header. Auto-generated if omitted. */
  deviceId?: string
}

export class CodexProvider extends OpenAIResponsesProvider {
  override name = 'codex'

  constructor(options: CodexProviderOptions) {
    const baseURL = options.baseURL || CODEX_BASE_URL
    const deviceId = options.deviceId || randomUUID()

    // The OpenAI SDK sends Authorization: Bearer <apiKey>, which is
    // exactly what the Codex backend expects for OAuth access tokens.
    super({ apiKey: options.accessToken, baseURL })

    // Recreate the client with required Codex headers
    this.client = new OpenAI({
      apiKey: options.accessToken,
      baseURL,
      defaultHeaders: {
        'oai-device-id': deviceId,
        'oai-language': 'en-US',
      },
    })
  }

  override buildParams(request: ChatRequest) {
    const params = super.buildParams(request)
    // Codex backend doesn't support the `reasoning` parameter —
    // strip it to avoid 400 errors.
    const raw = params as Record<string, unknown>
    delete raw.reasoning
    return params
  }
}
