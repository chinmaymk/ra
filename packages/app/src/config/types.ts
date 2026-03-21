import type { ContextConfig } from '../context/types'
import type {
  LogLevel,
  ProviderName,
  AnthropicProviderOptions,
  OpenAIProviderOptions,
  GoogleProviderOptions,
  OllamaProviderOptions,
  BedrockProviderOptions,
  AzureProviderOptions,
} from '@chinmaymk/ra'

export type { ProviderName } from '@chinmaymk/ra'

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

/** Per-tool configuration. `enabled` is universal; other keys are tool-specific and validated by each tool. */
export interface ToolSettings {
  /** Whether this tool is registered. Defaults to true when `tools.builtin` is true. */
  enabled?: boolean
  /** Arbitrary tool-specific settings (rootDir, maxConcurrency, etc.). */
  [key: string]: unknown
}

/** Tools configuration section. Replaces the old `builtinTools` boolean. */
export interface ToolsConfig {
  /** Master switch: when true, all builtin tools are registered unless individually disabled. Default: true. */
  builtin: boolean
  /** Per-tool overrides keyed by tool name (e.g. Read, Write, Bash, Agent). */
  overrides: Record<string, ToolSettings>
  /** Max characters for a single tool response. Responses exceeding this are truncated with a notice. Default 25000. */
  maxResponseSize?: number
}

export interface RaConfig {
  provider: ProviderName
  model: string
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio' | 'inspector' | 'cron'
  systemPrompt: string
  /** Directory containing the config file. All relative paths in config are resolved against this. Falls back to cwd when no config file is found. */
  configDir: string
  /** Root directory for all runtime data (sessions, memory, etc.). Relative paths are resolved against configDir. Defaults to `.ra`. */
  dataDir: string
  http: { port: number; token: string }
  inspector: { port: number }
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
    'openai-completions': OpenAIProviderOptions
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
  maxRetries: number
  toolTimeout: number
  tools: ToolsConfig
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
    prompt?: string        // custom summarization prompt, overrides default
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
  cron: {
    jobs: CronJobConfig[]
    /** Max concurrent job executions across all jobs. Falls back to global maxConcurrency. */
    maxConcurrency?: number
  }
}

/** Cron-specific fields that don't exist on RaConfig. */
export interface CronJobFields {
  /** Unique identifier for this job. */
  id: string
  /** Cron expression (5-field standard or 6-field with seconds). */
  schedule: string
  /** The user prompt to send to the agent each tick. */
  prompt: string
  /** IANA timezone (e.g., 'America/New_York'). Defaults to system timezone. */
  timezone?: string
  /** When true, reuse the same session across runs (accumulating context). Default: false. */
  persistent?: boolean
  /** What to do when a tick fires while the job is still running. Default: 'skip'. */
  overlapPolicy?: 'skip' | 'queue'
  /** Disable this job without removing it. Default: true. */
  enabled?: boolean
}

/** A cron job: cron-specific scheduling fields + any RaConfig overrides. */
export type CronJobConfig = CronJobFields & Partial<RaConfig>

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
