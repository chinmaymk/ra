import type { ResolverConfig } from './types'
import type { PatternResolver } from './resolvers'
import { builtinResolvers } from './builtin-resolvers'
import { resolvePath } from '../utils/paths'

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
      resolvers.push(builtinResolvers[config.name]!)
      continue
    }

    // Custom resolver from file
    if (config.path) {
      const resolved = resolvePath(config.path, cwd)
      const mod = await import(resolved)
      const resolver = mod.default as PatternResolver
      if (!resolver || !resolver.pattern || typeof resolver.resolve !== 'function') {
        console.warn(`[ra] Resolver file "${resolved}" must export a default PatternResolver — skipping`)
        continue
      }
      resolvers.push({ ...resolver, name: resolver.name || config.name })
      continue
    }

    console.warn(`[ra] Unknown resolver "${config.name}" — skipping (no built-in and no path specified)`)
  }

  return resolvers
}
