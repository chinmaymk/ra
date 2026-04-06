import { describe, it, expect } from 'bun:test'
import { ProviderError, withRetry, errorMessage } from '../../src/utils/errors'

describe('ProviderError.from', () => {
  it('classifies 429 as retryable rate_limit', () => {
    const err = ProviderError.from({ status: 429, message: 'Too many requests' })
    expect(err.category).toBe('rate_limit')
    expect(err.retryable).toBe(true)
  })

  it('classifies 401/403 as non-retryable auth', () => {
    expect(ProviderError.from({ status: 401, message: 'Unauthorized' }).category).toBe('auth')
    expect(ProviderError.from({ status: 403, message: 'Forbidden' }).category).toBe('auth')
    expect(ProviderError.from({ status: 401, message: '' }).retryable).toBe(false)
  })

  it('classifies 5xx as retryable server', () => {
    const err = ProviderError.from({ status: 500, message: 'Internal server error' })
    expect(err.category).toBe('server')
    expect(err.retryable).toBe(true)
  })

  it('classifies 529 as retryable overloaded', () => {
    const err = ProviderError.from({ status: 529, message: 'Overloaded' })
    expect(err.category).toBe('overloaded')
    expect(err.retryable).toBe(true)
  })

  it('classifies connection errors as retryable network', () => {
    expect(ProviderError.from(new Error('fetch failed')).category).toBe('network')
    expect(ProviderError.from(new Error('connect ECONNREFUSED 127.0.0.1:443')).category).toBe('network')
  })

  it('classifies unrecognized errors as non-retryable unknown', () => {
    const err = ProviderError.from(new Error('something unexpected'))
    expect(err.category).toBe('unknown')
    expect(err.retryable).toBe(false)
  })

  it('passes through existing ProviderError unchanged', () => {
    const original = new ProviderError('rate limited', { category: 'rate_limit', statusCode: 429 })
    expect(ProviderError.from(original)).toBe(original)
  })

  it('extracts retry-after header as milliseconds', () => {
    const err = ProviderError.from({
      status: 429,
      message: 'rate limited',
      headers: { get: (name: string) => name === 'retry-after' ? '5' : null },
    })
    expect(err.retryAfterMs).toBe(5000)
  })
})

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    let calls = 0
    const result = await withRetry(async () => { calls++; return 'ok' }, { maxRetries: 3, delays: [10] })
    expect(result).toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries retryable errors up to maxRetries then succeeds', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('rate limited'), { status: 429 })
      return 'ok'
    }, { maxRetries: 3, delays: [10, 10, 10] })
    expect(result).toBe('ok')
    expect(calls).toBe(3)
  })

  it('throws immediately on non-retryable errors', async () => {
    let calls = 0
    try {
      await withRetry(async () => { calls++; throw Object.assign(new Error('unauthorized'), { status: 401 }) }, { maxRetries: 3, delays: [10] })
    } catch (err) {
      expect((err as ProviderError).category).toBe('auth')
    }
    expect(calls).toBe(1)
  })

  it('gives up after exhausting maxRetries', async () => {
    let calls = 0
    try {
      await withRetry(async () => { calls++; throw Object.assign(new Error('server error'), { status: 500 }) }, { maxRetries: 2, delays: [10, 10] })
    } catch (err) {
      expect((err as ProviderError).category).toBe('server')
    }
    expect(calls).toBe(3) // initial + 2 retries
  })

  it('stops retrying when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    try {
      await withRetry(async () => { calls++; throw Object.assign(new Error('rate limited'), { status: 429 }) }, { maxRetries: 3, delays: [10], signal: controller.signal })
    } catch {}
    expect(calls).toBe(1)
  })

  it('uses retry-after delay when provider returns it', async () => {
    let calls = 0
    const start = Date.now()
    await withRetry(async () => {
      calls++
      if (calls === 1) {
        throw Object.assign(new Error('rate limited'), {
          status: 429,
          headers: { get: (name: string) => name === 'retry-after' ? '0' : null },
        })
      }
      return 'ok'
    }, { maxRetries: 3, delays: [10000] }) // large default delay, but retry-after=0 should override
    expect(Date.now() - start).toBeLessThan(5000)
    expect(calls).toBe(2)
  })

  it('calls onRetry callback with error and attempt number', async () => {
    const retries: { msg: string; attempt: number }[] = []
    let calls = 0
    await withRetry(async () => {
      calls++
      if (calls < 3) throw Object.assign(new Error('server error'), { status: 500 })
      return 'ok'
    }, {
      maxRetries: 3,
      delays: [10, 10, 10],
      onRetry: (err, attempt) => retries.push({ msg: err.message, attempt }),
    })
    expect(retries).toHaveLength(2)
    expect(retries[0]!.attempt).toBe(1)
    expect(retries[1]!.attempt).toBe(2)
  })
})

describe('errorMessage', () => {
  it('extracts message from Error objects', () => {
    expect(errorMessage(new Error('test error'))).toBe('test error')
  })

  it('stringifies non-Error values', () => {
    expect(errorMessage('string error')).toBe('string error')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(null)).toBe('null')
  })

  it('returns userMessage for ProviderError instances', () => {
    const err = new ProviderError('Unauthorized', { category: 'auth', statusCode: 401 })
    expect(errorMessage(err)).toContain('Authentication failed')
    expect(errorMessage(err)).toContain('API key')
  })
})

describe('ProviderError.userMessage', () => {
  it('auth error mentions API key', () => {
    const err = new ProviderError('Unauthorized', { category: 'auth', statusCode: 401 })
    expect(err.userMessage).toContain('Authentication failed')
    expect(err.userMessage).toContain('unauthorized')
    expect(err.userMessage).toContain('API key')
  })

  it('auth error with 403 mentions forbidden', () => {
    const err = new ProviderError('Forbidden', { category: 'auth', statusCode: 403 })
    expect(err.userMessage).toContain('forbidden')
  })

  it('rate limit error includes wait time when available', () => {
    const err = new ProviderError('rate limited', { category: 'rate_limit', statusCode: 429, retryAfterMs: 30000 })
    expect(err.userMessage).toContain('Rate limit exceeded')
    expect(err.userMessage).toContain('30s')
  })

  it('rate limit error without retryAfterMs omits wait time', () => {
    const err = new ProviderError('rate limited', { category: 'rate_limit', statusCode: 429 })
    expect(err.userMessage).toContain('Rate limit exceeded')
    expect(err.userMessage).not.toContain('Try again in')
  })

  it('overloaded error suggests waiting', () => {
    const err = new ProviderError('overloaded', { category: 'overloaded', statusCode: 529 })
    expect(err.userMessage).toContain('overloaded')
  })

  it('server error includes status code', () => {
    const err = new ProviderError('internal', { category: 'server', statusCode: 502 })
    expect(err.userMessage).toContain('502')
  })

  it('network error with ECONNREFUSED gives specific advice', () => {
    const err = new ProviderError('connect ECONNREFUSED 127.0.0.1:443', { category: 'network' })
    expect(err.userMessage).toContain('Connection refused')
  })

  it('network error with ENOTFOUND gives DNS advice', () => {
    const err = new ProviderError('getaddrinfo ENOTFOUND api.example.com', { category: 'network' })
    expect(err.userMessage).toContain('DNS lookup failed')
  })

  it('unknown error returns raw message', () => {
    const err = new ProviderError('something broke', { category: 'unknown' })
    expect(err.userMessage).toBe('something broke')
  })
})

describe('ProviderError classification', () => {
  it('classifies all network error patterns', () => {
    const patterns = [
      'connect ECONNREFUSED 127.0.0.1:443',
      'read ECONNRESET',
      'connect ETIMEDOUT',
      'getaddrinfo ENOTFOUND api.example.com',
      'fetch failed',
      'network error occurred',
      'socket hang up',
      'dns resolution failed',
    ]
    for (const msg of patterns) {
      const err = ProviderError.from(new Error(msg))
      expect(err.category).toBe('network')
      expect(err.retryable).toBe(true)
    }
  })

  it('classifies statusCode property (not just status)', () => {
    const err = ProviderError.from({ statusCode: 502, message: 'bad gateway' })
    expect(err.category).toBe('server')
  })

  it('classifies nested error.error.status', () => {
    const err = ProviderError.from({ error: { status: 429 }, message: 'rate limited' })
    expect(err.category).toBe('rate_limit')
  })

  it('extracts retry-after from plain object headers', () => {
    const err = ProviderError.from({
      status: 429,
      message: 'rate limited',
      headers: { 'retry-after': '10' },
    })
    expect(err.retryAfterMs).toBe(10000)
  })

  it('preserves cause in ProviderError', () => {
    const original = new Error('original')
    const pe = ProviderError.from(Object.assign(original, { status: 500 }))
    expect(pe.cause).toBe(original)
  })

  it('non-Error values are classified as unknown', () => {
    const err = ProviderError.from('just a string')
    expect(err.category).toBe('unknown')
    expect(err.message).toBe('just a string')
  })
})
