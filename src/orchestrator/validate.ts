import type { AppContext } from '../bootstrap'
import type { OrchestratorConfig } from './types'

const ALLOWED_KEYS = new Set([
  'agents',
  'interface',
  'sessionsDir',
  'skillDirs',
  'context',
  'http',
])

export function validateOrchestratorRaw(raw: Record<string, unknown>, filePath: string): void {
  // Required keys
  if (!raw.agents || typeof raw.agents !== 'object' || Array.isArray(raw.agents)) {
    throw new Error(`Missing or invalid "agents" in ${filePath}. Must be an object mapping agent names to configs.`)
  }
  if (!raw.interface || typeof raw.interface !== 'string') {
    throw new Error(`Missing "interface" in ${filePath}. Must be one of: cli, repl, http, mcp, mcp-stdio.`)
  }
  const validInterfaces = ['cli', 'repl', 'http', 'mcp', 'mcp-stdio']
  if (!validInterfaces.includes(raw.interface as string)) {
    throw new Error(`Invalid "interface" value "${raw.interface}" in ${filePath}. Must be one of: ${validInterfaces.join(', ')}.`)
  }

  // Unknown keys
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(
        `Unknown key "${key}" in ${filePath}.\n` +
        `Orchestrator config only accepts: ${[...ALLOWED_KEYS].join(', ')}.\n` +
        `Set "${key}" in individual agent configs instead.`
      )
    }
  }

  // Validate agents entries
  const agents = raw.agents as Record<string, unknown>
  const agentNames = Object.keys(agents)
  if (agentNames.length === 0) {
    throw new Error(`"agents" in ${filePath} must contain at least one agent.`)
  }

  let defaultCount = 0
  for (const name of agentNames) {
    const entry = agents[name]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Agent "${name}" in ${filePath} must be an object with a "config" path.`)
    }
    const agentEntry = entry as Record<string, unknown>
    if (!agentEntry.config || typeof agentEntry.config !== 'string') {
      throw new Error(`Agent "${name}" in ${filePath} must have a "config" string pointing to an ra.config.yml file.`)
    }
    if (agentEntry.default === true) defaultCount++
  }

  if (defaultCount > 1) {
    throw new Error(`At most one agent can have "default: true" in ${filePath}. Found ${defaultCount}.`)
  }

  // Validate context shape if present
  if (raw.context !== undefined) {
    if (typeof raw.context !== 'object' || Array.isArray(raw.context) || raw.context === null) {
      throw new Error(`"context" in ${filePath} must be an object with a "patterns" array.`)
    }
    const ctx = raw.context as Record<string, unknown>
    if (ctx.patterns !== undefined && !Array.isArray(ctx.patterns)) {
      throw new Error(`"context.patterns" in ${filePath} must be an array of strings.`)
    }
  }

  // Validate skillDirs shape if present
  if (raw.skillDirs !== undefined && !Array.isArray(raw.skillDirs)) {
    throw new Error(`"skillDirs" in ${filePath} must be an array of strings.`)
  }
}

export function validateNoNameCollisions(
  agentNames: string[],
  agents: Map<string, AppContext>,
): void {
  for (const agentName of agentNames) {
    for (const [otherName, ctx] of agents) {
      if (ctx.skillMap.has(agentName)) {
        throw new Error(
          `"${agentName}" is both an agent name and a skill name (loaded by agent "${otherName}"). Rename one.`
        )
      }
    }
  }
}
