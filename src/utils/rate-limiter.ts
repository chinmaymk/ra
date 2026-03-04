/**
 * Simple in-memory sliding-window rate limiter.
 * For distributed deployments, replace with Redis-backed implementation.
 */
export interface RateLimiterOptions {
  /** Max requests per window */
  maxRequests: number
  /** Window size in milliseconds */
  windowMs: number
}

interface ClientRecord {
  timestamps: number[]
}

export class RateLimiter {
  private clients = new Map<string, ClientRecord>()
  private maxRequests: number
  private windowMs: number
  private cleanupInterval: ReturnType<typeof setInterval>

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests
    this.windowMs = options.windowMs
    // Periodic cleanup of stale entries
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs * 2)
  }

  /** Returns true if the request is allowed, false if rate-limited */
  check(clientId: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now()
    const cutoff = now - this.windowMs

    let record = this.clients.get(clientId)
    if (!record) {
      record = { timestamps: [] }
      this.clients.set(clientId, record)
    }

    // Remove expired timestamps
    record.timestamps = record.timestamps.filter(t => t > cutoff)

    if (record.timestamps.length >= this.maxRequests) {
      const oldestInWindow = record.timestamps[0]!
      return {
        allowed: false,
        remaining: 0,
        resetMs: oldestInWindow + this.windowMs - now,
      }
    }

    record.timestamps.push(now)
    return {
      allowed: true,
      remaining: this.maxRequests - record.timestamps.length,
      resetMs: this.windowMs,
    }
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs
    for (const [key, record] of this.clients) {
      record.timestamps = record.timestamps.filter(t => t > cutoff)
      if (record.timestamps.length === 0) this.clients.delete(key)
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval)
    this.clients.clear()
  }
}
