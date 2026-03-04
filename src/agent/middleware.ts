import type { Middleware, StoppableContext } from './types'

export async function runMiddlewareChain<T extends StoppableContext>(
  ctx: T,
  chain: Middleware<T>[],
): Promise<void> {
  for (const mw of chain) {
    if (ctx.signal.aborted) break
    await mw(ctx)
  }
}
