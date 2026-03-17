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

const HOOK_KEYS: (keyof MiddlewareConfig)[] = [
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
]

/**
 * Concatenates multiple partial middleware configs into a full
 * MiddlewareConfig.  Hooks from later layers run after earlier layers.
 * Missing hooks become empty arrays.
 */
export function concatMiddleware(
  ...layers: (Partial<MiddlewareConfig> | undefined)[]
): MiddlewareConfig {
  const result: Record<string, unknown[]> = {}
  for (const key of HOOK_KEYS) result[key] = []
  for (const layer of layers) {
    if (!layer) continue
    for (const key of HOOK_KEYS) {
      const incoming = layer[key] as unknown[] | undefined
      if (incoming?.length) result[key]!.push(...incoming)
    }
  }
  return result as unknown as MiddlewareConfig
}
