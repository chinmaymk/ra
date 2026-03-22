/**
 * ra application types.
 *
 * Core types (IProvider, IMessage, AgentLoop, etc.) are published
 * via the @chinmaymk/ra package. This file re-exports app-specific
 * types only.
 */

// Config types
export type {
  ProviderName,
  RaConfig,
  McpServerEntry,
  McpServerConfig,
  LoadConfigOptions,
  ToolsConfig,
  ToolSettings,
} from './config/types'

// Skill types
export type {
  SkillMetadata,
  Skill,
} from './skills/types'

// Context / resolver types
export type {
  PatternResolver,
  ResolvedReference,
  ResolutionResult,
} from './context/resolvers'
export type { ResolverConfig } from './context/types'

// Built-in tools
export { registerBuiltinTools } from './tools/index'
export { subagentTool } from './tools/subagent'
export type { SubagentToolOptions } from './tools/subagent'
