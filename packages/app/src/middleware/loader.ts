import { looksLikePath, resolvePath } from '../utils/paths'
import { importFresh } from '../utils/import-fresh'
import { errorMessage, NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig, Middleware } from '@chinmaymk/ra'
import { isShellEntry } from '../shell'
import { createShellMiddleware } from './shell'

const VALID_HOOKS = new Set<keyof MiddlewareConfig>([
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
])

async function loadOne<T>(entry: string, hook: string, cwd: string, logger: Logger, timeoutMs: number): Promise<Middleware<T>> {
  if (isShellEntry(entry)) {
    return createShellMiddleware<T & import('@chinmaymk/ra').StoppableContext>(entry, hook, cwd, logger, timeoutMs) as Middleware<T>
  }
  if (looksLikePath(entry)) {
    const resolved = resolvePath(entry, cwd)
    let mod: Record<string, unknown>
    try {
      mod = await importFresh(resolved)
    } catch (err) {
      const detail = errorMessage(err)
      if (detail.includes('Cannot find module') || detail.includes('ENOENT') || detail.includes('not found')) {
        throw new Error(`Middleware file not found: "${resolved}". Check the path in your config under middleware.${hook}.`)
      }
      throw new Error(`Failed to import middleware file "${resolved}" for hook "${hook}": ${detail}`)
    }
    if (typeof mod.default !== 'function') {
      throw new Error(`Middleware file "${resolved}" must export a default function, but got ${typeof mod.default}. See docs for middleware format.`)
    }
    return mod.default as Middleware<T>
  }
  let fn: unknown
  try {
    const transpiler = new Bun.Transpiler({ loader: 'ts', deadCodeElimination: false })
    const js = await transpiler.transform(`(${entry})`)
    fn = (0, eval)(js)
  } catch (err) {
    throw new Error(`Failed to parse inline middleware expression for hook "${hook}": ${errorMessage(err)}\n  Expression: ${entry}`)
  }
  if (typeof fn !== 'function') {
    throw new Error(`Inline middleware expression for hook "${hook}" must evaluate to a function, but got ${typeof fn}.\n  Expression: ${entry}`)
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
    const timeoutMs = config.agent.toolTimeout ?? 0
    const fns = await Promise.all(entries.map(e => loadOne(e, hook, cwd, log, timeoutMs)))
    ;(result as Record<string, unknown[]>)[hook] = fns
    log.debug('middleware hook loaded', { hook, count: fns.length })
  }

  return result
}
