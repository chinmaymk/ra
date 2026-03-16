/**
 * Multi-agent orchestrator — boots multiple agents in a single process,
 * each with its own AppContext and isolated data directory.
 */
import { join } from 'path'
import { loadConfig } from './config'
import { bootstrap, type AppContext } from './bootstrap'
import type { RaConfig } from './config/types'

export interface MultiAgentContext {
  agents: Map<string, AppContext>
  defaultAgent: string
  shutdown: () => Promise<void>
}

export async function bootstrapMultiAgent(config: RaConfig): Promise<MultiAgentContext> {
  const agents = new Map<string, AppContext>()
  const entries = Object.entries(config.agents!)
  const defaultAgent = config.defaultAgent ?? entries[0]![0]

  const results = await Promise.all(entries.map(async ([name, configPath]) => {
    const agentConfig = await loadConfig({ configPath, cwd: config.configDir })
    agentConfig.dataDir = join(config.dataDir, name)
    delete agentConfig.agents
    delete agentConfig.defaultAgent
    const app = await bootstrap(agentConfig, {})
    return [name, app] as const
  }))
  for (const [name, app] of results) agents.set(name, app)

  const shutdown = async () => {
    for (const app of agents.values()) {
      await app.shutdown()
    }
  }

  return { agents, defaultAgent, shutdown }
}
