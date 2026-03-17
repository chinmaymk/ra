import type { ContextConfig } from '../context/types'
import type { LogLevel } from '../observability/logger'
import type { ObservabilityConfig } from '../observability'
import type { AnthropicProviderOptions } from '../providers/anthropic'
import type { OpenAIProviderOptions } from '../providers/openai'
import type { GoogleProviderOptions } from '../providers/google'
import type { OllamaProviderOptions } from '../providers/ollama'
import type { BedrockProviderOptions } from '../providers/bedrock'
import type { AzureProviderOptions } from '../providers/azure'

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'ollama' | 'bedrock' | 'azure'

/** Regex-based allow/deny rules for a specific field of a tool's input. */
export interface PermissionFieldRule {
  allow?: string[]
  deny?: string[]
}

/** Permission rule targeting a specific tool. `tool` is the tool name, other keys are field names mapped to allow/deny regex arrays. */
export interface PermissionRule {
  tool: string
  [field: string]: PermissionFieldRule | string | undefined
}

export interface PermissionsConfig {
  /** When true, all tools are allowed without checking rules. Default: false. */
  no_rules_rules?: boolean
  /** Default action when no rule matches a tool: 'allow' or 'deny'. Default: 'allow'. */
  default_action?: 'allow' | 'deny'
  /** Permission rules per tool. */
  rules?: PermissionRule[]
}

export interface RaConfig {
  provider: ProviderName
  model: string
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio'
  systemPrompt: string
  /** Directory containing the config file. All relative paths in config are resolved against this. Falls back to cwd when no config file is found. */
  configDir: string
  /** Root directory for all runtime data (sessions, memory, etc.). Relative paths are resolved against configDir. Defaults to `.ra`. */
  dataDir: string
  http: { port: number; token: string }
  skillDirs: string[]
  skills: string[]
  mcp: {
    client: McpClientConfig[]
    server: McpServerConfig
    /** When true, MCP tools are registered with server-prefixed names and minimal schemas.
     *  First call returns full schema; model retries with correct params. Saves tokens. */
    lazySchemas: boolean
  }
  providers: {
    anthropic: AnthropicProviderOptions
    openai: OpenAIProviderOptions
    google: GoogleProviderOptions
    ollama: OllamaProviderOptions
    bedrock: BedrockProviderOptions
    azure: AzureProviderOptions
  }
  storage: {
    format: 'jsonl'
    maxSessions: number
    ttlDays: number
  }
  maxIterations: number
  toolTimeout: number
  builtinTools: boolean
  builtinSkills: Record<string, boolean>
  permissions: PermissionsConfig
  middleware: Record<string, string[]>
  thinking?: 'low' | 'medium' | 'high'
  maxConcurrency: number
  context: ContextConfig
  compaction: {
    enabled: boolean
    threshold: number      // 0-1, trigger ratio of context window
    maxTokens?: number     // absolute token trigger, overrides threshold * contextWindow
    contextWindow?: number // per-provider override for context window size
    model?: string         // cheaper model for summarization, defaults per provider
    onCompact?: (info: { originalMessages: number; compactedMessages: number; estimatedTokens: number; threshold: number }) => void
  }
  memory: {
    enabled: boolean
    maxMemories: number  // max stored memories (oldest trimmed first)
    ttlDays: number      // auto-prune memories older than this
    injectLimit: number  // memories to inject as context per loop (0 to disable)
  }
  logsEnabled: boolean
  logLevel: LogLevel
  tracesEnabled: boolean
  /** Derived observability config — computed from logsEnabled, tracesEnabled, logLevel. */
  observability: ObservabilityConfig
}

export interface McpClientConfig {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
}

export interface McpServerConfig {
  enabled: boolean
  port: number
  tool: {
    name: string
    description: string
  }
}

export interface LoadConfigOptions {
  cwd?: string
  configPath?: string
  cliArgs?: Partial<RaConfig>
  env?: Record<string, string | undefined>
}
