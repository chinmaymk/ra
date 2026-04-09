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
  CodexProviderOptions,
  AnthropicAgentsSdkProviderOptions,
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
  disabled?: boolean
  /** Default action when no rule matches a tool: 'allow' or 'deny'. Default: 'allow'. */
  defaultAction?: 'allow' | 'deny'
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

/**
 * Tools configuration section. Per-tool settings sit directly under this object,
 * alongside the reserved keys `builtin`, `custom`, and `maxResponseSize`:
 *
 *   tools:
 *     builtin: true
 *     custom: [./tools/deploy.ts]
 *     maxResponseSize: 25000
 *     Read: { rootDir: "./src" }
 *     WebFetch: { enabled: false }
 *     Agent: { maxConcurrency: 2 }
 */
export interface ToolsConfig {
  /** Master switch: when true, all built-in tools are registered unless individually disabled. Default: true. */
  builtin: boolean
  /** File paths to custom tool files (JS/TS/shell scripts). */
  custom?: string[]
  /** Max characters for a single tool response. Responses exceeding this are truncated. Default 25000. */
  maxResponseSize?: number
  /** Per-tool overrides keyed by tool name (Read, Bash, Agent, WebFetch, etc.). */
  [toolName: string]: ToolSettings | boolean | string[] | number | undefined
}

/** MCP configuration — client (connect to servers) and server (expose ra). */
export interface McpConfig {
  /** External MCP servers to connect to. */
  servers: McpServerEntry[]
  /** When true, MCP tools are registered with minimal schemas. First call returns the full schema;
   *  the model retries with correct params. Saves tokens. Default: true. */
  lazySchemas: boolean
  /** Ra's own MCP server endpoint (exposes ra as an MCP tool). */
  server: RaMcpServerConfig
}

/** Application-level settings — how the app runs, infrastructure, observability. */
export interface AppConfig {
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio' | 'inspector' | 'cron'
  /** Directory containing the config file. All relative paths in config are resolved against this. Falls back to cwd when no config file is found. */
  configDir: string
  /** Root directory for all runtime data (sessions, memory, etc.). Relative paths are resolved against configDir. Defaults to `~/.ra/<handle>`. */
  dataDir: string
  /** Hot-reload config and referenced files (system prompt, tools, middleware) between loops. Default true. */
  hotReload: boolean
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
    codex: CodexProviderOptions
    'anthropic-agents-sdk': AnthropicAgentsSdkProviderOptions
  }
  /** MCP client + server config (external servers to connect to, and ra's own server endpoint). */
  mcp: McpConfig
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

/**
 * A single cron job definition. A job runs `prompt` against the agent on the
 * given `schedule`. To customize the agent per job, use either `recipe`
 * (load a recipe YAML as base) or `overrides` (inline Partial<AgentConfig>
 * merged on top of the base agent config), or both.
 */
export interface CronJob {
  /** Human-readable name for this job (used in logs). */
  name: string
  /** Cron expression (e.g. "0 9 * * 1-5"). */
  schedule: string
  /** Prompt to send to the agent on each run. */
  prompt: string
  /** Optional recipe (path or installed name) to use as base agent config for this job. */
  recipe?: string
  /** Inline agent config overrides merged on top of the base config. */
  overrides?: Partial<AgentConfig>
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

// ── Helpers for reading the ToolsConfig index-signature shape ────────────

const TOOL_RESERVED_KEYS = new Set(['builtin', 'custom', 'maxResponseSize'])

/** Return per-tool settings for a given tool name. Empty object if none. */
export function toolOption(tools: ToolsConfig, name: string): ToolSettings {
  const v = (tools as Record<string, unknown>)[name]
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v as ToolSettings : {}
}

/** Return a map of all per-tool settings keyed by tool name. */
export function allToolOptions(tools: ToolsConfig): Record<string, ToolSettings> {
  const result: Record<string, ToolSettings> = {}
  for (const [k, v] of Object.entries(tools)) {
    if (TOOL_RESERVED_KEYS.has(k)) continue
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = v as ToolSettings
    }
  }
  return result
}
