// ── Provider types ──────────────────────────────────────────────────
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
  ProviderName,
} from './providers/types'

// ── Provider utilities ──────────────────────────────────────────────
export {
  accumulateUsage,
  parseToolArguments,
  mergeConsecutiveRoles,
  mergeConsecutive,
  extractTextContent,
  serializeContent,
  extractSystemMessages,
  THINKING_BUDGETS,
} from './providers/utils'

// ── Provider implementations ────────────────────────────────────────
export { AnthropicProvider, type AnthropicProviderOptions } from './providers/anthropic'
export { OpenAIProvider, OpenAICompletionsProvider, type OpenAIProviderOptions } from './providers/openai'
export { OpenAIResponsesProvider, type OpenAIResponsesProviderOptions } from './providers/openai-responses'
export type { OpenAIProviderOptions as OpenAICompletionsProviderOptions } from './providers/openai-completions'
export { GoogleProvider, type GoogleProviderOptions } from './providers/google'
export { OllamaProvider, type OllamaProviderOptions } from './providers/ollama'
export { BedrockProvider, type BedrockProviderOptions } from './providers/bedrock'
export { AzureProvider, type AzureProviderOptions } from './providers/azure'
export { createProvider, buildProviderConfig, type ProviderConfig } from './providers/registry'

// ── Agent / middleware types ────────────────────────────────────────
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
} from './agent/types'

// ── Agent runtime ───────────────────────────────────────────────────
export { AgentLoop, type AgentLoopOptions, type LoopResult } from './agent/loop'
export { ToolRegistry } from './agent/tool-registry'
export { runMiddlewareChain, mergeMiddleware } from './agent/middleware'
export { createCompactionMiddleware, splitMessageZones, type CompactionConfig, type MessageZones } from './agent/context-compaction'
export { withTimeout, TimeoutError } from './agent/timeout'
export { estimateTokens, estimateTextTokens, estimateToolTokens } from './agent/token-estimator'
export { getContextWindowSize, getDefaultCompactionModel } from './agent/model-registry'

// ── Observability ───────────────────────────────────────────────────
export type { Logger, LogLevel, LogEntry } from './observability/logger'
export { NoopLogger } from './observability/logger'

// ── Utilities ───────────────────────────────────────────────────────
export { errorMessage } from './utils/errors'
