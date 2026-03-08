import type { Middleware, StoppableContext } from './types'
import { withTimeout, TimeoutError } from './timeout'

export async function runMiddlewareChain<T extends StoppableContext>(
  ctx: T,
  chain: Middleware<T>[],
  timeoutMs: number = 0,
): Promise<void> {
  for (const mw of chain) {
    if (ctx.signal.aborted) break
    if (timeoutMs > 0) {
      try {
        await withTimeout(mw(ctx), timeoutMs, 'middleware')
      } catch (err) {
        if (err instanceof TimeoutError) continue
        throw err
      }
    } else {
      await mw(ctx)
    }
  }
}
