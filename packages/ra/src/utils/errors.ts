/** Extract error message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Categorized provider API error for graceful handling. */
export type ProviderErrorCategory = 'rate_limit' | 'auth' | 'network' | 'server' | 'overloaded' | 'unknown'

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory
  readonly statusCode?: number
  readonly retryAfterMs?: number

  get retryable(): boolean {
    return this.category === 'rate_limit' || this.category === 'server' || this.category === 'overloaded' || this.category === 'network'
  }

  constructor(message: string, options: { category: ProviderErrorCategory; statusCode?: number; retryAfterMs?: number; cause?: unknown }) {
    super(message)
    this.name = 'ProviderError'
    this.category = options.category
    this.statusCode = options.statusCode
    this.retryAfterMs = options.retryAfterMs
    this.cause = options.cause
  }

  /** Classify an unknown error thrown by a provider SDK into a ProviderError. */
  static from(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err

    const status = extractStatusCode(err)
    const retryAfterMs = extractRetryAfter(err)
    const message = err instanceof Error ? err.message : String(err)

    if (status === 401 || status === 403) {
      return new ProviderError(message, { category: 'auth', statusCode: status, cause: err })
    }
    if (status === 429) {
      return new ProviderError(message, { category: 'rate_limit', statusCode: status, retryAfterMs, cause: err })
    }
    if (status === 529) {
      return new ProviderError(message, { category: 'overloaded', statusCode: status, retryAfterMs, cause: err })
    }
    if (status !== undefined && status >= 500) {
      return new ProviderError(message, { category: 'server', statusCode: status, cause: err })
    }

    if (isNetworkError(err)) {
      return new ProviderError(message, { category: 'network', cause: err })
    }

    return new ProviderError(message, { category: 'unknown', statusCode: status, cause: err })
  }
}

function extractStatusCode(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const obj = err as Record<string, unknown>
  // Most SDK errors expose `status` or `statusCode`
  if (typeof obj.status === 'number') return obj.status
  if (typeof obj.statusCode === 'number') return obj.statusCode
  // Nested in error or response
  const nested = obj.error
  if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).status === 'number') {
    return (nested as Record<string, unknown>).status as number
  }
  return undefined
}

function extractRetryAfter(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined
  const headers = (err as Record<string, unknown>).headers
  if (!headers || typeof headers !== 'object') return undefined
  const val = typeof (headers as Record<string, unknown>).get === 'function'
    ? (headers as { get: (k: string) => string | null }).get('retry-after')
    : (headers as Record<string, unknown>)['retry-after']
  if (val) {
    const secs = Number(val)
    if (!isNaN(secs)) return secs * 1000
  }
  return undefined
}

const NETWORK_PATTERNS = ['econnrefused', 'econnreset', 'etimedout', 'enotfound', 'fetch failed', 'network', 'socket hang up', 'dns'] as const

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return NETWORK_PATTERNS.some(p => msg.includes(p))
}

const DEFAULT_DELAYS = [1000, 2000, 4000]

/** Retry an async function with exponential backoff for retryable errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; delays?: number[]; signal?: AbortSignal; onRetry?: (error: ProviderError, attempt: number) => void },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3
  const delays = options?.delays ?? DEFAULT_DELAYS

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const providerError = ProviderError.from(err)

      if (!providerError.retryable || attempt >= maxRetries || options?.signal?.aborted) {
        throw providerError
      }

      const baseDelay = delays[Math.min(attempt, delays.length - 1)] ?? delays[0]!
      const delay = providerError.retryAfterMs ?? baseDelay
      options?.onRetry?.(providerError, attempt + 1)
      await sleep(delay, options?.signal)
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}
