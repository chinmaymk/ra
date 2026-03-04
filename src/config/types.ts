import type { AnthropicProviderOptions } from '../providers/anthropic'
import type { OpenAIProviderOptions } from '../providers/openai'
import type { GoogleProviderOptions } from '../providers/google'
import type { OllamaProviderOptions } from '../providers/ollama'

export type ProviderName = 'anthropic' | 'openai' | 'google' | 'ollama'

export interface RaConfig {
  provider: ProviderName
  model: string
  interface: 'cli' | 'repl' | 'http' | 'mcp'
  systemPrompt: string
  http: { port: number; token: string }
  skills: string[]
  alwaysLoad: string[]
  mcp: {
    client: McpClientConfig[]
    server: McpServerConfig
  }
  providers: {
    anthropic: AnthropicProviderOptions
    openai: OpenAIProviderOptions
    google: GoogleProviderOptions
    ollama: OllamaProviderOptions
  }
  storage: {
    path: string
    format: 'jsonl'
    maxSessions: number
    ttlDays: number
  }
  maxIterations: number
  middleware: Record<string, string[]>
}

export interface McpClientConfig {
  name: string
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
}

export interface McpServerConfig {
  enabled: boolean
  transport: 'stdio' | 'http'
  port: number
  tool: {
    name: string
    description: string
    inputSchema: Record<string, unknown>
  }
}

export interface LoadConfigOptions {
  cwd?: string
  configPath?: string
  cliArgs?: Partial<RaConfig>
  env?: Record<string, string | undefined>
}
