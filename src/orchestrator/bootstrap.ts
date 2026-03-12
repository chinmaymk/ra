import { isAbsolute, join } from 'path'
import { bootstrap, type AppContext } from '../bootstrap'
import { loadConfig } from '../config'
import { mergeAgentConfig } from './merge'
import type { OrchestratorConfig, OrchestratorContext } from './types'
import { validateNoNameCollisions } from './validate'

export async function bootstrapOrchestrator(
  config: OrchestratorConfig,
): Promise<OrchestratorContext> {
  let defaultAgent: string | undefined

  // Bootstrap all agents in parallel — each gets its own provider, tools, middleware, memory
  const entries = Object.entries(config.agents)
  const results = await Promise.all(
    entries.map(async ([name, entry]) => {
      const configPath = isAbsolute(entry.config)
        ? entry.config
        : join(config.configDir, entry.config)

      const agentConfig = await loadConfig({ configPath })
      const mergedConfig = mergeAgentConfig(agentConfig, config, name)
      const appContext = await bootstrap(mergedConfig, {})

      if (entry.default) defaultAgent = name

      return [name, appContext] as const
    }),
  )

  const agents = new Map<string, AppContext>(results)

  validateNoNameCollisions(entries.map(([name]) => name), agents)

  const shutdown = async () => {
    await Promise.allSettled([...agents.values()].map(ctx => ctx.shutdown()))
  }

  return { config, agents, defaultAgent, shutdown }
}
