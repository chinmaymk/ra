import { describe, it, expect } from 'bun:test'
import { ProviderError, withRetry } from '../../src/utils/errors'

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
})
