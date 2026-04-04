import type { ContextConfig } from '../context/types'
import type {
  LogLevel,
  ProviderName,
  ThinkingMode,
  AnthropicProviderOptions,
  OpenAIProviderOptions,
  GoogleProviderOptions,
  OllamaProviderOptions,
  BedrockProviderOptions,
  AzureProviderOptions,
  AgentSdkProviderOptions,
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
  /** File paths to custom tool files (JS/TS). Each file must default-export an ITool object or a factory function returning one. */
  custom?: string[]
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
  /** Provider credentials and connection options. Agent selects which one to use via `agent.provider`. */
  providers: {
    anthropic: AnthropicProviderOptions
    openai: OpenAIProviderOptions
    'openai-completions': OpenAIProviderOptions
    google: GoogleProviderOptions
    ollama: OllamaProviderOptions
    bedrock: BedrockProviderOptions
    azure: AzureProviderOptions
    'agent-sdk': AgentSdkProviderOptions
  }
  /** External MCP servers to connect to. */
  mcpServers: McpServerEntry[]
  /** When true, MCP tools are registered with server-prefixed names and minimal schemas.
   *  First call returns full schema; model retries with correct params. Saves tokens. */
  mcpLazySchemas: boolean
  /** Ra's own MCP server endpoint configuration. */
  raMcpServer: RaMcpServerConfig
  logsEnabled: boolean
  logLevel: LogLevel
  tracesEnabled: boolean
}

/** Agent behavior settings — LLM config, tools, context, memory, capabilities. */
export interface AgentConfig {
  /** Installed recipe name (owner/repo) or local path to use as base agent config. */
  recipe?: string
  provider: ProviderName
  model: string
  thinking?: ThinkingMode
  /** Absolute cap on thinking budget tokens. When set, providers use min(levelBudget, cap). */
  thinkingBudgetCap?: number
  systemPrompt: string
  maxIterations: number
  maxRetries: number
  toolTimeout: number
  maxConcurrency: number
  /** Execute tool calls in parallel when the model returns multiple in a single response. Default true. */
  parallelToolCalls: boolean
  /** Max total tokens (input + output) before the loop stops. 0 = unlimited. */
  maxTokenBudget: number
  /** Max wall-clock duration in milliseconds before the loop stops. 0 = unlimited. */
  maxDuration: number
  tools: ToolsConfig
  skillDirs: string[]
  permissions: PermissionsConfig
  middleware: Record<string, string[]>
  context: ContextConfig
  compaction: {
    enabled: boolean
    threshold: number      // 0-1, trigger ratio of context window
    strategy?: 'truncate' | 'summarize' // 'truncate' drops old messages (free, cache-friendly), 'summarize' calls the model
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

export interface McpServerEntry {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
}

export interface RaMcpServerConfig {
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
  /** Recipe name (from --recipe flag) to load as base agent config. */
  recipeName?: string
}
