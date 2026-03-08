import type { ContextConfig } from '../context/types'
import type { AnthropicProviderOptions } from '../providers/anthropic'
import type { OpenAIProviderOptions } from '../providers/openai'
import type { GoogleProviderOptions } from '../providers/google'
import type { OllamaProviderOptions } from '../providers/ollama'
import type { BedrockProviderOptions } from '../providers/bedrock'
import type { AzureProviderOptions } from '../providers/azure'

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'ollama' | 'bedrock' | 'azure'

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
  context: ContextConfig
  compaction: {
    enabled: boolean
    threshold: number      // 0-1, trigger ratio of context window
    maxTokens?: number     // absolute token trigger, overrides threshold * contextWindow
    contextWindow?: number // per-provider override for context window size
    model?: string         // cheaper model for summarization, defaults per provider
  }
  memory: {
    enabled: boolean
    path: string               // SQLite database path
    maxSizeMB: number          // max database size in MB
    ttlDays: number            // long-term memory TTL
    sessionTTLHours: number    // session memory TTL (default: 24)
    extractor?: string         // path to custom extractor module
    patterns?: Array<{         // custom extraction patterns (merged with defaults)
      pattern: string
      roles?: ('user' | 'assistant' | 'tool' | 'system')[]
      tag: string
      layer?: 'session' | 'long-term'
      maxLength?: number
      capture?: 'match' | 'full'
    }>
    autoExtract: boolean       // pattern-based extraction per iteration
    reflect: boolean           // LLM-driven reflective extraction on loop complete
    reflectionModel?: string   // model for reflection (cheaper model recommended)
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
