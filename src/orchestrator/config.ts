import { dirname, isAbsolute, join } from 'path'
import yaml from 'js-yaml'
import { parse as parseToml } from 'smol-toml'
import { validateOrchestratorRaw } from './validate'
import type { OrchestratorConfig, OrchestratorAgentEntry } from './types'

const ORCHESTRATOR_FILES = [
  'ra.agents.json',
  'ra.agents.yaml',
  'ra.agents.yml',
  'ra.agents.toml',
]

async function parseFile(path: string): Promise<Record<string, unknown>> {
  const content = await Bun.file(path).text()
  if (path.endsWith('.json')) return JSON.parse(content) as Record<string, unknown>
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return yaml.load(content) as Record<string, unknown>
  if (path.endsWith('.toml')) return parseToml(content) as Record<string, unknown>
  throw new Error(`Unsupported config format: ${path}`)
}

export async function loadOrchestratorConfig(filePath: string): Promise<OrchestratorConfig> {
  const fullPath = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath)

  if (!await Bun.file(fullPath).exists()) {
    throw new Error(`Orchestrator config not found: ${fullPath}`)
  }

  const raw = await parseFile(fullPath)
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
  let dir = cwd
  while (true) {
    for (const name of ORCHESTRATOR_FILES) {
      const full = join(dir, name)
      if (await Bun.file(full).exists()) return full
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}
