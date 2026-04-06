import type { ResolverConfig } from './types'
import type { PatternResolver } from './resolvers'
import { builtinResolvers } from './builtin-resolvers'
import { resolvePath } from '../utils/paths'
import { importFresh } from '../utils/import-fresh'

/**
 * Load pattern resolvers from config.
 * Built-in resolvers are looked up by name; custom resolvers are imported from path.
 */
export async function loadResolvers(
  configs: ResolverConfig[],
  cwd: string,
): Promise<PatternResolver[]> {
  const resolvers: PatternResolver[] = []

  for (const config of configs) {
    if (!config.enabled) continue

    // Built-in resolver
    if (config.name in builtinResolvers && !config.path) {
      resolvers.push(builtinResolvers[config.name] as PatternResolver)
      continue
    }

    // Custom resolver from file
    if (config.path) {
      const resolved = resolvePath(config.path, cwd)
      const mod = await importFresh(resolved)
      const resolver = mod.default as PatternResolver
      if (!resolver || !(resolver.pattern instanceof RegExp) || typeof resolver.resolve !== 'function') {
        console.warn('[ra] Resolver file must export a default PatternResolver — skipping', resolved)
        continue
      }
      resolvers.push({ ...resolver, name: resolver.name || config.name })
      continue
    }

    console.warn('[ra] Unknown resolver — skipping (no built-in and no path specified)', config.name)
  }

  return resolvers
}
