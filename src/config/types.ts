import type { ContextConfig } from '../context/types'
import type { AnthropicProviderOptions } from '../providers/anthropic'
import type { OpenAIProviderOptions } from '../providers/openai'
import type { GoogleProviderOptions } from '../providers/google'
import type { OllamaProviderOptions } from '../providers/ollama'
import type { BedrockProviderOptions } from '../providers/bedrock'
import type { AzureProviderOptions } from '../providers/azure'
import type { LogLevel } from '../observability/logger'

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'ollama' | 'bedrock' | 'azure'

export interface RaConfig {
  provider: ProviderName
  model: string
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio'
  systemPrompt: string
  /** Directory containing the config file. All relative paths in config are resolved against this. Falls back to cwd when no config file is found. */
  configDir: string
  http: { port: number; token: string }
  skillDirs: string[]
  skills: string[]
  mcp: {
    client: McpClientConfig[]
    server: McpServerConfig
    /** When true, MCP tools are registered with truncated descriptions and minimal schemas.
     *  A `get_mcp_tool_schema` meta-tool lets the model fetch full schemas on demand. Saves tokens. */
    lazySchemas: boolean
    /** Max characters for truncated MCP tool descriptions when lazySchemas is enabled */
    maxDescriptionLength: number
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
    path: string
    format: 'jsonl'
    maxSessions: number
    ttlDays: number
  }
  maxIterations: number
  toolTimeout: number
  builtinTools: boolean
  builtinSkills: Record<string, boolean>
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
    path: string         // SQLite database path
    maxMemories: number  // max stored memories (oldest trimmed first)
    ttlDays: number      // auto-prune memories older than this
    injectLimit: number  // memories to inject as context per loop (0 to disable)
  }
  observability: {
    enabled: boolean
    logs: {
      level: LogLevel      // minimum log level: 'debug' | 'info' | 'warn' | 'error'
      output: 'stderr' | 'stdout' | 'file'
      filePath?: string    // required when output is 'file'
    }
    traces: {
      output: 'stderr' | 'stdout' | 'file'
      filePath?: string    // required when output is 'file'
    }
  }
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
