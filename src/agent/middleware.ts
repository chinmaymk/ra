import type { Middleware, MiddlewareConfig, StoppableContext } from './types'
import { withTimeout, TimeoutError } from './timeout'

/** Merge multiple partial middleware configs, concatenating hook arrays in order. */
export function mergeMiddleware(...configs: Partial<MiddlewareConfig>[]): Partial<MiddlewareConfig> {
  const merged: Partial<MiddlewareConfig> = {}
  for (const config of configs) {
    for (const key of Object.keys(config) as (keyof MiddlewareConfig)[]) {
      const existing = merged[key] ?? []
      const incoming = config[key] ?? []
      ;(merged as Record<string, Middleware<any>[]>)[key] = [...existing, ...incoming]
    }
  }
  return merged
}

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
