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

  for (const [name, configPath] of entries) {
    // Load the agent's own config file
    const agentConfig = await loadConfig({ configPath, cwd: config.configDir })

    // Override dataDir to nest under orchestrator's dataDir
    agentConfig.dataDir = join(config.dataDir, name)

    // Strip orchestrator-level fields from agent config
    delete agentConfig.agents
    delete agentConfig.defaultAgent

    const app = await bootstrap(agentConfig, {})
    agents.set(name, app)
  }

  const shutdown = async () => {
    for (const app of agents.values()) {
      await app.shutdown()
    }
  }

  return { agents, defaultAgent, shutdown }
}
