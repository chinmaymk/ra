/**
 * @chinmaymk/ra — Type definitions only.
 *
 * This package publishes types for the ra AI agent framework.
 * It does NOT include runtime code. For the CLI and runtime,
 * install ra via the compiled binaries from GitHub releases.
 *
 * @see https://github.com/chinmaymk/ra
 */

// Re-export everything from @chinmaymk/ra core
export {
  // Provider types
  type ContentPart,
  type ImageSource,
  type IMessage,
  type IToolCall,
  type IToolResult,
  type ITool,
  type TokenUsage,
  type StreamChunk,
  type ChatRequest,
  type ChatResponse,
  type IProvider,
  type ProviderName,
  // Agent / middleware types
  type StoppableContext,
  type LoopContext,
  type ModelCallContext,
  type StreamChunkContext,
  type ToolExecutionContext,
  type ToolResultContext,
  type ErrorContext,
  type Middleware,
  type MiddlewareConfig,
  // Observability types
  type Logger,
  type LogLevel,
  type LogEntry,
  // Provider option types
  type AnthropicProviderOptions,
  type OpenAIProviderOptions,
  type GoogleProviderOptions,
  type OllamaProviderOptions,
  type BedrockProviderOptions,
  type AzureProviderOptions,
} from '@chinmaymk/ra'

// Config types (app-specific)
export type {
  RaConfig,
  McpClientConfig,
  McpServerConfig,
  LoadConfigOptions,
  ToolsConfig,
  ToolSettings,
} from './config/types.ts'

// Skill types (app-specific)
export type {
  SkillMetadata,
  Skill,
} from './skills/types.ts'

// Context / resolver types (app-specific)
export type {
  PatternResolver,
  ResolvedReference,
  ResolutionResult,
} from './context/resolvers.ts'
export type { ResolverConfig } from './context/types.ts'

// Built-in tools
export { registerBuiltinTools } from './tools/index'
export { subagentTool } from './tools/subagent'
export type { SubagentToolOptions } from './tools/subagent'
