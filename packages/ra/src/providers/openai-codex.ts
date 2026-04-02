import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { OpenAIResponsesProvider } from './openai-responses'
import type { ChatRequest } from './types'

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'

export interface CodexProviderOptions {
  accessToken: string
  baseURL?: string
  deviceId?: string
}

export class CodexProvider extends OpenAIResponsesProvider {
  override name = 'codex'

  constructor(options: CodexProviderOptions) {
    const baseURL = options.baseURL || CODEX_BASE_URL
    // super() creates a throwaway client — immediately replaced below.
    // Necessary because TS requires super() before accessing `this`.
    super({ apiKey: options.accessToken, baseURL })
    this.client = new OpenAI({
      apiKey: options.accessToken,
      baseURL,
      defaultHeaders: {
        'oai-device-id': options.deviceId || randomUUID(),
        'oai-language': 'en-US',
      },
    })
  }

  override buildParams(request: ChatRequest) {
    const params = super.buildParams(request)
    // Codex backend doesn't support the `reasoning` parameter
    delete (params as Record<string, unknown>).reasoning
    return params
  }
}
