import { join, isAbsolute } from 'path'
import { homedir } from 'os'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig, Middleware } from '../agent/types'

const VALID_HOOKS = new Set<keyof MiddlewareConfig>([
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
])

function isFilePath(s: string): boolean {
  return s.startsWith('./') || s.startsWith('../') || s.startsWith('/') || s.startsWith('~') ||
    s.endsWith('.js') || s.endsWith('.ts')
}

async function loadOne<T>(entry: string, cwd: string): Promise<Middleware<T>> {
  if (isFilePath(entry)) {
    let resolved = isAbsolute(entry) ? entry : join(cwd, entry)
    if (entry.startsWith('~')) resolved = join(homedir(), entry.slice(1))
    const mod = await import(resolved)
    if (typeof mod.default !== 'function') {
      throw new Error(`Middleware file "${resolved}" must export a default function`)
    }
    return mod.default as Middleware<T>
  }
  let fn: unknown
  try {
    const transpiler = new Bun.Transpiler({ loader: 'ts', deadCodeElimination: false })
    const js = transpiler.transformSync(`(${entry})`)
    fn = (0, eval)(js)
  } catch (err) {
    throw new Error(`Failed to parse inline middleware expression: ${err instanceof Error ? err.message : String(err)}\n  Expression: ${entry}`)
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
