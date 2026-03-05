/**
 * @chinmaymk/ra — Type definitions only.
 *
 * This package publishes types for the ra AI agent framework.
 * It does NOT include runtime code. For the CLI and runtime,
 * install ra via the compiled binaries from GitHub releases.
 *
 * @see https://github.com/chinmaymk/ra
 */

// Provider types
export type {
  ContentPart,
  ImageSource,
  IMessage,
  IToolCall,
  IToolResult,
  ITool,
  TokenUsage,
  StreamChunk,
  ChatRequest,
  ChatResponse,
  IProvider,
} from './providers/types.ts'

// Agent / middleware types
export type {
  StoppableContext,
  LoopContext,
  ModelCallContext,
  StreamChunkContext,
  ToolExecutionContext,
  ToolResultContext,
  ErrorContext,
  Middleware,
  MiddlewareConfig,
} from './agent/types.ts'

// Config types
export type {
  ProviderName,
  RaConfig,
  McpClientConfig,
  McpServerConfig,
  LoadConfigOptions,
} from './config/types.ts'

// Skill types
export type {
  SkillMetadata,
  Skill,
} from './skills/types.ts'

// Provider option types
export type { AnthropicProviderOptions } from './providers/anthropic.ts'
export type { OpenAIProviderOptions } from './providers/openai.ts'
export type { GoogleProviderOptions } from './providers/google.ts'
export type { OllamaProviderOptions } from './providers/ollama.ts'
export type { BedrockProviderOptions } from './providers/bedrock.ts'
export type { AzureProviderOptions } from './providers/azure.ts'

// Built-in tools
export { registerBuiltinTools } from './tools/index.ts'
export { ASK_USER_SIGNAL } from './tools/ask-user.ts'
