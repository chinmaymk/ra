import { describe, it, expect } from 'bun:test'
import { runMiddlewareChain } from '../../src/agent/middleware'

describe('runMiddlewareChain', () => {
  it('runs middleware in order', async () => {
    const order: number[] = []
    const chain = [
      async (_ctx: any, next: () => Promise<void>) => { order.push(1); await next(); order.push(4) },
      async (_ctx: any, next: () => Promise<void>) => { order.push(2); await next(); order.push(3) },
    ]
    await runMiddlewareChain({}, chain)
    expect(order).toEqual([1, 2, 3, 4])
  })

  it('short-circuits when next is not called', async () => {
    const order: number[] = []
    const chain = [
      async (_ctx: any, _next: () => Promise<void>) => { order.push(1) },
      async (_ctx: any, next: () => Promise<void>) => { order.push(2); await next() },
    ]
    await runMiddlewareChain({}, chain)
    expect(order).toEqual([1])
  })

  it('passes context to all middleware', async () => {
    const ctx = { value: 0 }
    const chain = [
      async (c: any, next: () => Promise<void>) => { c.value += 1; await next() },
      async (c: any, next: () => Promise<void>) => { c.value += 10; await next() },
    ]
    await runMiddlewareChain(ctx, chain)
    expect(ctx.value).toBe(11)
  })

  it('handles empty chain', async () => {
    await runMiddlewareChain({}, [])
    // should not throw
  })
})
