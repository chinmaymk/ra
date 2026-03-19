/** Extract error message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Categorized provider API error for graceful handling. */
export type ProviderErrorCategory = 'rate_limit' | 'auth' | 'network' | 'server' | 'overloaded' | 'unknown'

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory
  readonly statusCode?: number
  readonly retryable: boolean
  readonly retryAfterMs?: number

  constructor(message: string, options: { category: ProviderErrorCategory; statusCode?: number; retryAfterMs?: number; cause?: unknown }) {
    super(message)
    this.name = 'ProviderError'
    this.category = options.category
    this.statusCode = options.statusCode
    this.retryable = options.category === 'rate_limit' || options.category === 'server' || options.category === 'overloaded' || options.category === 'network'
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
  if (err && typeof err === 'object') {
    // Most SDK errors expose `status` or `statusCode`
    if ('status' in err && typeof (err as any).status === 'number') return (err as any).status
    if ('statusCode' in err && typeof (err as any).statusCode === 'number') return (err as any).statusCode
    // Nested in error or response
    if ('error' in err && typeof (err as any).error === 'object' && (err as any).error?.status) return (err as any).error.status
  }
  return undefined
}

function extractRetryAfter(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'headers' in err) {
    const headers = (err as any).headers
    const val = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after']
    if (val) {
      const secs = Number(val)
      if (!isNaN(secs)) return secs * 1000
    }
  }
  return undefined
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  const networkPatterns = ['econnrefused', 'econnreset', 'etimedout', 'enotfound', 'fetch failed', 'network', 'socket hang up', 'dns']
  return networkPatterns.some(p => msg.includes(p))
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

      const baseDelay = delays[Math.min(attempt, delays.length - 1)]
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
