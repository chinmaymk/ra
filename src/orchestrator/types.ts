import type { AppContext } from '../bootstrap'

export interface OrchestratorAgentEntry {
  config: string        // path to ra.config.yml (relative to orchestrator config dir)
  default?: boolean     // at most one agent
}

export interface OrchestratorConfig {
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio'
  sessionsDir: string   // default: './sessions'
  skillDirs: string[]   // merged into each agent's skillDirs
  context: {
    patterns: string[]  // merged into each agent's context.patterns
  }
  agents: Record<string, OrchestratorAgentEntry>
  configDir: string     // directory containing the orchestrator config file
  http?: { port: number; token?: string }
}

export interface OrchestratorContext {
  config: OrchestratorConfig
  agents: Map<string, AppContext>
  defaultAgent: string | undefined
  shutdown: () => Promise<void>
}
