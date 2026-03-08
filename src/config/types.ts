import type { ContextConfig } from '../context/types'
import type { AnthropicProviderOptions } from '../providers/anthropic'
import type { OpenAIProviderOptions } from '../providers/openai'
import type { GoogleProviderOptions } from '../providers/google'
import type { OllamaProviderOptions } from '../providers/ollama'
import type { BedrockProviderOptions } from '../providers/bedrock'
import type { AzureProviderOptions } from '../providers/azure'

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'ollama' | 'bedrock' | 'azure'

/** Per-tool configuration set by the recipe author */
export interface ToolConfig {
  subagent?: SubagentConfig
}

/** Recipe-author configuration for subagent behavior */
export interface SubagentConfig {
  /** Model override for subagents (default: parent's model) */
  model?: string
  /** System prompt: 'inherit' copies parent's, 'none' omits, or a custom string (default: 'none') */
  system?: 'inherit' | 'none' | string
  /** Tool allowlist — ceiling on which tools subagents can access (default: all parent tools) */
  allowedTools?: string[]
  /** Max iterations per subagent run (default: 5) */
  maxTurns?: number
  /** Max concurrent subagent tasks (default: 4) */
  maxConcurrency?: number
  /** Thinking level override (default: parent's thinking level) */
  thinking?: 'low' | 'medium' | 'high'
}

export interface RaConfig {
  provider: ProviderName
  model: string
  interface: 'cli' | 'repl' | 'http' | 'mcp' | 'mcp-stdio'
  systemPrompt: string
  http: { port: number; token: string }
  skillDirs: string[]
  skills: string[]
  mcp: {
    client: McpClientConfig[]
    server: McpServerConfig
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
  middleware: Record<string, string[]>
  thinking?: 'low' | 'medium' | 'high'
  toolConfig: ToolConfig
  context: ContextConfig
  compaction: {
    enabled: boolean
    threshold: number      // 0-1, trigger ratio of context window
    maxTokens?: number     // absolute token trigger, overrides threshold * contextWindow
    contextWindow?: number // per-provider override for context window size
    model?: string         // cheaper model for summarization, defaults per provider
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
