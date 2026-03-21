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

/** Application-level settings — how the app runs, infrastructure, observability. */
export interface AppConfig {
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio' | 'inspector' | 'cron'
  /** Directory containing the config file. All relative paths in config are resolved against this. Falls back to cwd when no config file is found. */
  configDir: string
  /** Root directory for all runtime data (sessions, memory, etc.). Relative paths are resolved against configDir. Defaults to `.ra`. */
  dataDir: string
  http: { port: number; token: string }
  inspector: { port: number }
  storage: {
    format: 'jsonl'
    maxSessions: number
    ttlDays: number
  }
  skillDirs: string[]
  mcp: {
    client: McpClientConfig[]
    server: McpServerConfig
    /** When true, MCP tools are registered with server-prefixed names and minimal schemas.
     *  First call returns full schema; model retries with correct params. Saves tokens. */
    lazySchemas: boolean
  }
  permissions: PermissionsConfig
  logsEnabled: boolean
  logLevel: LogLevel
  tracesEnabled: boolean
}

/** Agent behavior settings — LLM config, tools, context, memory. */
export interface AgentConfig {
  provider: ProviderName
  model: string
  thinking?: 'low' | 'medium' | 'high'
  systemPrompt: string
  providers: {
    anthropic: AnthropicProviderOptions
    openai: OpenAIProviderOptions
    'openai-completions': OpenAIProviderOptions
    google: GoogleProviderOptions
    ollama: OllamaProviderOptions
    bedrock: BedrockProviderOptions
    azure: AzureProviderOptions
  }
  maxIterations: number
  maxRetries: number
  toolTimeout: number
  maxConcurrency: number
  tools: ToolsConfig
  middleware: Record<string, string[]>
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
}

/** A single cron job definition. */
export interface CronJob {
  /** Human-readable name for this job (used in logs). */
  name: string
  /** Cron expression (e.g. "0 9 * * 1-5"). */
  schedule: string
  /** Agent config: path to a recipe YAML file, or partial AgentConfig to merge with base. */
  agent?: string | Partial<AgentConfig>
  /** Prompt to send to the agent on each run. */
  prompt: string
}

export interface RaConfig {
  app: AppConfig
  agent: AgentConfig
  /** Cron job definitions. Only used when `app.interface` is `'cron'`. */
  cron?: CronJob[]
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
