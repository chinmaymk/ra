import { describe, it, expect, afterEach } from 'bun:test'
import { RateLimiter } from '../../src/utils/rate-limiter'

describe('RateLimiter', () => {
  let limiter: RateLimiter

  afterEach(() => {
    limiter?.destroy()
  })

  it('allows requests under the limit', () => {
    limiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 })
    for (let i = 0; i < 5; i++) {
      const result = limiter.check('client1')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(4 - i)
    }
  })

  it('blocks requests over the limit', () => {
    limiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 })
    limiter.check('client1')
    limiter.check('client1')
    const result = limiter.check('client1')
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.resetMs).toBeGreaterThan(0)
  })

  it('tracks clients independently', () => {
    limiter = new RateLimiter({ maxRequests: 1, windowMs: 60000 })
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('b').allowed).toBe(true)
  })
})
