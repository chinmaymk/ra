import { isAbsolute, join } from 'path'
import { bootstrap, type AppContext } from '../bootstrap'
import { loadConfig } from '../config'
import { mergeAgentConfig } from './merge'
import type { OrchestratorConfig, OrchestratorContext } from './types'
import { validateNoNameCollisions } from './validate'

export async function bootstrapOrchestrator(
  config: OrchestratorConfig,
): Promise<OrchestratorContext> {
  const agents = new Map<string, AppContext>()
  let defaultAgent: string | undefined

  const agentNames = Object.keys(config.agents)

  for (const [name, entry] of Object.entries(config.agents)) {
    // Resolve agent config path against orchestrator configDir
    const configPath = isAbsolute(entry.config)
      ? entry.config
      : join(config.configDir, entry.config)

    // Load the agent's own config (defaults → file → env → no CLI flags)
    const agentConfig = await loadConfig({ configPath })

    // Merge orchestrator overrides
    const mergedConfig = mergeAgentConfig(agentConfig, config, name)

    // Full bootstrap — each agent gets its own provider, tools, middleware, memory
    const appContext = await bootstrap(mergedConfig, {})

    agents.set(name, appContext)

    if (entry.default) {
      defaultAgent = name
    }
  }

  // Validate no agent name collides with a skill name
  validateNoNameCollisions(agentNames, agents)

  const shutdown = async () => {
    const shutdowns = [...agents.values()].map(ctx => ctx.shutdown())
    await Promise.allSettled(shutdowns)
  }

  return { config, agents, defaultAgent, shutdown }
}
