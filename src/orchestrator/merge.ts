import { join, isAbsolute } from 'path'
import type { RaConfig } from '../config/types'
import { resolvePath } from '../utils/paths'
import type { OrchestratorConfig } from './types'

export function mergeAgentConfig(
  agentConfig: RaConfig,
  orchConfig: OrchestratorConfig,
  agentName: string,
): RaConfig {
  const sessionsDir = resolvePath(orchConfig.sessionsDir, orchConfig.configDir)
  const agentDir = join(sessionsDir, agentName)

  // Resolve orchestrator skillDirs against orchestrator configDir
  const orchSkillDirs = orchConfig.skillDirs.map(d => resolvePath(d, orchConfig.configDir))

  return {
    ...agentConfig,

    // Override: orchestrator controls interface
    interface: orchConfig.interface,

    // Override: sessions go to orchestrator's sessionsDir/{agentName}
    storage: {
      ...agentConfig.storage,
      path: agentDir,
    },

    // Override: memory path isolated per agent (only path, not enabled/settings)
    memory: {
      ...agentConfig.memory,
      ...(agentConfig.memory.enabled && { path: join(agentDir, 'memory.db') }),
    },

    // Merge: append orchestrator skillDirs after agent's
    skillDirs: [...agentConfig.skillDirs, ...orchSkillDirs],

    // Merge: append orchestrator context patterns after agent's
    context: {
      ...agentConfig.context,
      patterns: [...agentConfig.context.patterns, ...orchConfig.context.patterns],
    },
  }
}
