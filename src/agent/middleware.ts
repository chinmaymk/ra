import type { Middleware, MiddlewareConfig, StoppableContext } from './types'
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

/** Merge partial middleware layers into a single partial config. Later layers run after earlier ones. */
export function mergeMiddleware(...layers: (Partial<MiddlewareConfig> | undefined)[]): Partial<MiddlewareConfig> {
  const out: Record<string, unknown[]> = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [key, hooks] of Object.entries(layer)) {
      if (hooks?.length) out[key] = [...(out[key] ?? []), ...hooks]
    }
  }
  return out as Partial<MiddlewareConfig>
}
