import { join, isAbsolute } from 'path'
import { homedir } from 'os'
import type { ResolverConfig } from './types'
import type { PatternResolver } from './resolvers'
import { builtinResolvers } from './builtin-resolvers'

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
      let resolved = isAbsolute(config.path) ? config.path : join(cwd, config.path)
      if (config.path.startsWith('~/')) resolved = join(homedir(), config.path.slice(2))
      const mod = await import(resolved)
      const resolver = mod.default as PatternResolver
      if (!resolver || !resolver.pattern || typeof resolver.resolve !== 'function') {
        console.warn(`[ra] Resolver file "${resolved}" must export a default PatternResolver — skipping`)
        continue
      }
      // Use the config name if the resolver doesn't have one
      if (!resolver.name) resolver.name = config.name
      resolvers.push(resolver)
      continue
    }

    console.warn(`[ra] Unknown resolver "${config.name}" — skipping (no built-in and no path specified)`)
  }

  return resolvers
}
