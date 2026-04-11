import { importFresh } from '../../utils/import-fresh'
import { looksLikePath, resolvePath } from '../../utils/paths'
import { errorMessage, NoopLogger } from '@chinmaymk/ra'
import type { Logger } from '@chinmaymk/ra'
import type { WebPanelDefinition } from './types'
import { diffPanel } from './diff'

const BUILTIN: Record<string, WebPanelDefinition> = {
  diff: diffPanel,
}

/** Recognize `foo` and `builtin:foo` forms; returns the bare id or undefined. */
function parseBuiltinId(entry: string): string | undefined {
  if (entry in BUILTIN) return entry
  if (entry.startsWith('builtin:')) {
    const id = entry.slice('builtin:'.length)
    return id in BUILTIN ? id : undefined
  }
  return undefined
}

function isPanelDefinition(x: unknown): x is WebPanelDefinition {
  return typeof x === 'object' && x !== null
    && typeof (x as WebPanelDefinition).id === 'string'
    && typeof (x as WebPanelDefinition).title === 'string'
}

/**
 * Load web panels from `agent.web.panels`: builtin ids (`diff`, `builtin:diff`) or
 * paths to modules that default-export a WebPanelDefinition (or factory `() => WebPanelDefinition`).
 */
export async function loadWebPanels(
  entries: string[] | undefined,
  configDir: string,
  logger?: Logger,
): Promise<WebPanelDefinition[]> {
  const log = logger ?? new NoopLogger()
  const list = entries ?? []
  const out: WebPanelDefinition[] = []
  const seen = new Set<string>()

  const register = (def: WebPanelDefinition, logPath?: string): void => {
    if (seen.has(def.id)) {
      log.debug('duplicate web panel id, skipping', { id: def.id, path: logPath })
      return
    }
    seen.add(def.id)
    out.push(def)
    if (logPath) log.info('web panel registered', { id: def.id, path: logPath })
    else log.debug('web panel registered', { id: def.id, source: 'builtin' })
  }

  for (const raw of list) {
    const entry = raw.trim()
    if (!entry) continue

    const builtinId = parseBuiltinId(entry)
    if (builtinId) {
      register(BUILTIN[builtinId]!)
      continue
    }

    if (entry.startsWith('builtin:')) {
      log.warn('unknown builtin web panel, skipping', { entry })
      continue
    }

    if (!looksLikePath(entry)) {
      log.warn('web panel entry is not a builtin id or file path, skipping', { entry })
      continue
    }

    const resolved = resolvePath(entry, configDir)
    let mod: Record<string, unknown>
    try {
      mod = await importFresh(resolved)
    } catch (err) {
      const detail = errorMessage(err)
      if (detail.includes('Cannot find module') || detail.includes('ENOENT') || detail.includes('not found')) {
        throw new Error(`Web panel file not found: "${resolved}". Check agent.web.panels in your config.`)
      }
      throw new Error(`Failed to import web panel "${resolved}": ${detail}`)
    }

    // Accept: object, factory `() => WebPanelDefinition`, or async factory.
    let defRaw: unknown = mod.default
    if (typeof defRaw === 'function') defRaw = (defRaw as () => unknown)()
    defRaw = await Promise.resolve(defRaw)
    if (!isPanelDefinition(defRaw)) {
      throw new Error(`Web panel "${resolved}" must default-export a WebPanelDefinition (object with id and title).`)
    }

    register({ ...defRaw, source: resolved }, resolved)
  }

  return out
}
