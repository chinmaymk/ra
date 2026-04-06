import { randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { OpenAIResponsesProvider } from './openai-responses'
import type { ChatRequest, ChatResponse, StreamChunk } from './types'
import { ProviderError } from '../utils/errors'

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex'
const CODEX_DEFAULT_MODEL = 'gpt-5.4'

export interface CodexProviderOptions {
  accessToken: string
  baseURL?: string
  deviceId?: string
}

/** Extract chatgpt_account_id from the JWT access token payload. */
function extractAccountId(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
    return payload['https://api.openai.com/auth']?.chatgpt_account_id as string | undefined
  } catch {
    return undefined
  }
}

/**
 * Custom fetch wrapper that rewrites Codex error responses into the standard
 * OpenAI `{"error":{"message":"..."}}` format. The Codex backend returns
 * FastAPI-style `{"detail":"..."}` which the SDK can't parse, resulting in
 * the unhelpful "400 status code (no body)" message.
 */
function codexFetch(input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> {
  return fetch(input, init).then(async (res) => {
    if (res.ok) return res
    const body = await res.text()
    let rewritten = body
    try {
      const parsed = JSON.parse(body) as { detail?: string }
      if (parsed.detail) {
        rewritten = JSON.stringify({ error: { message: parsed.detail, type: 'invalid_request_error' } })
      }
    } catch { /* use body as-is */ }
    return new Response(rewritten, { status: res.status, statusText: res.statusText, headers: res.headers })
  })
}

export class CodexProvider extends OpenAIResponsesProvider {
  override name = 'codex'

  constructor(options: CodexProviderOptions) {
    const baseURL = options.baseURL || CODEX_BASE_URL
    // super() creates a throwaway client — immediately replaced below.
    // Necessary because TS requires super() before accessing `this`.
    super({ apiKey: options.accessToken, baseURL })

    const headers: Record<string, string> = {
      'oai-device-id': options.deviceId || randomUUID(),
      'oai-language': 'en-US',
      // Required by the Codex backend — signals Responses API support
      'openai-beta': 'responses=experimental',
      'originator': 'ra',
    }
    const accountId = extractAccountId(options.accessToken)
    if (accountId) headers['chatgpt-account-id'] = accountId

    this.client = new OpenAI({
      apiKey: options.accessToken,
      baseURL,
      defaultHeaders: headers,
      fetch: codexFetch,
    })
  }

  override buildParams(request: ChatRequest) {
    // Default to the Codex-optimized model when none is specified
    if (!request.model) request.model = CODEX_DEFAULT_MODEL
    const params = super.buildParams(request)
    const raw = params as Record<string, unknown>
    // Codex backend requires `instructions` — provide a default if absent
    if (!raw.instructions) raw.instructions = 'You are a helpful assistant.'
    // Codex backend may not support `reasoning` — strip to be safe
    delete raw.reasoning
    // Codex backend does not support server-side storage
    raw.store = false
    return params
  }
}
