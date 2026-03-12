import { dirname, isAbsolute, join } from 'path'
import { parseConfigFile } from '../config'
import { findFileUpwards } from '../utils/paths'
import { validateOrchestratorRaw } from './validate'
import type { OrchestratorConfig, OrchestratorAgentEntry } from './types'

const ORCHESTRATOR_FILES = [
  'ra.agents.json',
  'ra.agents.yaml',
  'ra.agents.yml',
  'ra.agents.toml',
]

export async function loadOrchestratorConfig(filePath: string): Promise<OrchestratorConfig> {
  const fullPath = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath)

  if (!await Bun.file(fullPath).exists()) {
    throw new Error(`Orchestrator config not found: ${fullPath}`)
  }

  const raw = await parseConfigFile(fullPath)
  validateOrchestratorRaw(raw, fullPath)

  const configDir = dirname(fullPath)

  // Validate agent config files exist
  const agents = raw.agents as Record<string, Record<string, unknown>>
  for (const [name, entry] of Object.entries(agents)) {
    const configPath = entry.config as string
    const resolved = isAbsolute(configPath) ? configPath : join(configDir, configPath)
    if (!await Bun.file(resolved).exists()) {
      throw new Error(`Agent "${name}" config not found: ${resolved}`)
    }
  }

  // Build typed agents map
  const typedAgents: Record<string, OrchestratorAgentEntry> = {}
  for (const [name, entry] of Object.entries(agents)) {
    typedAgents[name] = {
      config: entry.config as string,
      ...(entry.default === true && { default: true }),
    }
  }

  const context = raw.context as Record<string, unknown> | undefined

  return {
    interface: raw.interface as OrchestratorConfig['interface'],
    sessionsDir: (raw.sessionsDir as string) ?? './sessions',
    skillDirs: (raw.skillDirs as string[]) ?? [],
    context: {
      patterns: (context?.patterns as string[]) ?? [],
    },
    agents: typedAgents,
    configDir,
    ...(raw.http ? { http: raw.http as { port: number; token?: string } } : {}),
  }
}

export async function discoverOrchestratorConfig(cwd: string): Promise<string | undefined> {
  return findFileUpwards(cwd, ORCHESTRATOR_FILES)
}
