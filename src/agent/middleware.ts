import type { Middleware } from './types'

export async function runMiddlewareChain<T>(ctx: T, chain: Middleware<T>[]): Promise<void> {
  let index = 0

  async function next(): Promise<void> {
    if (index >= chain.length) return
    const middleware = chain[index++]!
    await middleware(ctx, next)
  }

  await next()
}
