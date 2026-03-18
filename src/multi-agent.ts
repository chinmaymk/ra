/**
 * Agent bootstrapper — single-agent produces a context with one entry
 * named "default"; multi-agent produces one entry per configured agent,
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

export async function bootstrapAgents(config: RaConfig): Promise<MultiAgentContext> {
  if (config.agents && Object.keys(config.agents).length > 0) {
    const entries = Object.entries(config.agents)
    const defaultAgent = config.defaultAgent ?? entries[0]![0]

    const results = await Promise.all(entries.map(async ([name, configPath]) => {
      const agentConfig = await loadConfig({ configPath, cwd: config.configDir })
      agentConfig.dataDir = join(config.dataDir, name)
      delete agentConfig.agents
      delete agentConfig.defaultAgent
      const app = await bootstrap(agentConfig, {})
      return [name, app] as const
    }))

    const agents = new Map(results)
    return {
      agents,
      defaultAgent,
      shutdown: async () => { for (const app of agents.values()) await app.shutdown() },
    }
  }

  // Single-agent: wrap as one entry named "default"
  const app = await bootstrap(config, {})
  return {
    agents: new Map([['default', app]]),
    defaultAgent: 'default',
    shutdown: app.shutdown,
  }
}
