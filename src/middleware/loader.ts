import { errMsg } from '../providers/utils'
import { looksLikePath, resolvePath } from '../utils/paths'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig, Middleware } from '../agent/types'

const VALID_HOOKS = new Set<keyof MiddlewareConfig>([
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
])

async function loadOne<T>(entry: string, cwd: string): Promise<Middleware<T>> {
  if (looksLikePath(entry)) {
    const resolved = resolvePath(entry, cwd)
    const mod = await import(resolved)
    if (typeof mod.default !== 'function') {
      throw new Error(`Middleware file "${resolved}" must export a default function`)
    }
    return mod.default as Middleware<T>
  }
  let fn: unknown
  try {
    const transpiler = new Bun.Transpiler({ loader: 'ts', deadCodeElimination: false })
    const js = await transpiler.transform(`(${entry})`)
    fn = (0, eval)(js)
  } catch (err) {
    throw new Error(`Failed to parse inline middleware expression: ${errMsg(err)}\n  Expression: ${entry}`)
  }
  if (typeof fn !== 'function') {
    throw new Error(`Inline middleware expression must evaluate to a function. Got: ${typeof fn}`)
  }
  return fn as Middleware<T>
}

export async function loadMiddleware(
  config: RaConfig,
  cwd: string,
): Promise<Partial<MiddlewareConfig>> {
  const result: Partial<MiddlewareConfig> = {}

  for (const [hook, entries] of Object.entries(config.middleware ?? {})) {
    if (!VALID_HOOKS.has(hook as keyof MiddlewareConfig)) {
      console.warn(`[ra] Unknown middleware hook "${hook}" — skipping`)
      continue
    }
    const fns = await Promise.all(entries.map(e => loadOne(e, cwd)))
    ;(result as Record<string, unknown[]>)[hook] = fns
  }

  return result
}
