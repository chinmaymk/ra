import { looksLikePath, resolvePath } from '../utils/paths'
import { errorMessage } from '../utils/errors'
import type { RaConfig } from '../config/types'
import type { MiddlewareConfig, Middleware } from '../agent/types'

const VALID_HOOKS = new Set<keyof MiddlewareConfig>([
  'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk',
  'beforeToolExecution', 'afterToolExecution', 'afterModelResponse',
  'afterLoopIteration', 'afterLoopComplete', 'onError',
])

/** Detect whether Bun's transpiler is available at runtime. */
function hasBunTranspiler(): boolean {
  try {
    return typeof (globalThis as Record<string, any>).Bun?.Transpiler === 'function'
  } catch {
    return false
  }
}

/** Transpile a TypeScript expression to JavaScript. Tries Bun first, falls back to esbuild, then raw eval. */
async function transpileExpression(code: string): Promise<string> {
  if (hasBunTranspiler()) {
    const transpiler = new (globalThis as Record<string, any>).Bun.Transpiler({ loader: 'ts', deadCodeElimination: false })
    return transpiler.transform(code) as string
  }

  // Try esbuild if installed
  try {
    // @ts-ignore -- esbuild is an optional dependency
    const esbuild = await import('esbuild')
    const result = await esbuild.transform(code, { loader: 'ts' })
    return result.code
  } catch { /* esbuild not available */ }

  // Fallback: return as-is (works for plain JS expressions)
  return code
}

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
    const js = await transpileExpression(`(${entry})`)
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
