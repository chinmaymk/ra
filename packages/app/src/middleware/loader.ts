import { looksLikePath, resolvePath } from '../utils/paths'
import { errorMessage, NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig, Middleware } from '@chinmaymk/ra'
import { createShellMiddleware } from './shell'

const VALID_HOOKS = new Set<keyof MiddlewareConfig>([
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
])

/** File extensions treated as shell/script middleware (auto-detected, no prefix needed). */
const SHELL_EXTENSIONS = [
  '.sh', '.bash', '.zsh',           // Unix shells
  '.py', '.rb', '.pl', '.php',      // Scripting languages
  '.lua', '.r', '.R',               // Other languages
  '.bat', '.cmd', '.ps1',           // Windows
]

/** Returns true if the entry uses the explicit `shell:` prefix. */
export function hasShellPrefix(entry: string): boolean {
  return entry.startsWith('shell:')
}

/** Returns true if the entry is a file path with a known script extension. */
export function isShellPath(entry: string): boolean {
  return looksLikePath(entry, SHELL_EXTENSIONS) && SHELL_EXTENSIONS.some(ext => entry.endsWith(ext))
}

/** Returns true if the entry should be handled as shell middleware (prefix or script extension). */
export function isShellEntry(entry: string): boolean {
  return hasShellPrefix(entry) || isShellPath(entry)
}

async function loadOne<T>(entry: string, hook: string, cwd: string, logger: Logger): Promise<Middleware<T>> {
  if (hasShellPrefix(entry)) {
    return createShellMiddleware<T & import('@chinmaymk/ra').StoppableContext>(entry, hook, cwd, logger) as Middleware<T>
  }
  if (isShellPath(entry)) {
    // Auto-detected script file — wrap as "shell: <path>" for the shell executor
    return createShellMiddleware<T & import('@chinmaymk/ra').StoppableContext>(`shell: ${entry}`, hook, cwd, logger) as Middleware<T>
  }
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
    const fns = await Promise.all(entries.map(e => loadOne(e, hook, cwd, log)))
    ;(result as Record<string, unknown[]>)[hook] = fns
    log.debug('middleware hook loaded', { hook, count: fns.length })
  }

  return result
}
