import type { Middleware, StoppableContext } from './types'
import { withTimeout, TimeoutError } from './timeout'

export async function runMiddlewareChain<T extends StoppableContext>(
  ctx: T,
  chain: Middleware<T>[],
  timeoutMs: number = 0,
): Promise<void> {
  for (const mw of chain) {
    if (ctx.signal.aborted) break
    try {
      await (timeoutMs > 0 ? withTimeout(mw(ctx), timeoutMs, 'middleware') : mw(ctx))
    } catch (err) {
      if (err instanceof TimeoutError) continue
      throw err
    }
  }
}
