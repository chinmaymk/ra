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
