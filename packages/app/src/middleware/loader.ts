import { looksLikePath, resolvePath } from '../utils/paths'
import { errorMessage, NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig, Middleware } from '@chinmaymk/ra'

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
    throw new Error(`Failed to parse inline middleware expression: ${errorMessage(err)}\n  Expression: ${entry}`)
  }
  if (typeof fn !== 'function') {
    throw new Error(`Inline middleware expression must evaluate to a function. Got: ${typeof fn}`)
  }
  return fn as Middleware<T>
}

export async function loadMiddleware(
  config: RaConfig,
  cwd: string,
  logger?: Logger,
): Promise<Partial<MiddlewareConfig>> {
  const log = logger ?? new NoopLogger()
  const result: Partial<MiddlewareConfig> = {}

  for (const [hook, entries] of Object.entries(config.agent.middleware ?? {})) {
    if (!VALID_HOOKS.has(hook as keyof MiddlewareConfig)) {
      log.warn('unknown middleware hook, skipping', { hook })
      continue
    }
    const fns = await Promise.all(entries.map(e => loadOne(e, cwd)))
    ;(result as Record<string, unknown[]>)[hook] = fns
    log.debug('middleware hook loaded', { hook, count: fns.length })
  }

  return result
}
