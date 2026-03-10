import type { IToolCall, IToolResult, StreamChunk, IMessage, ChatRequest, TokenUsage } from '../providers/types'

export interface StoppableContext {
  stop: (reason?: string) => void
  signal: AbortSignal
}

export interface LoopContext extends StoppableContext {
  messages: IMessage[]
  iteration: number
  maxIterations: number
  sessionId: string
  usage: TokenUsage
  lastUsage: TokenUsage | undefined
}

export interface ModelCallContext extends StoppableContext {
  request: ChatRequest
  loop: LoopContext
}

export interface StreamChunkContext extends StoppableContext {
  chunk: StreamChunk
  loop: LoopContext
}

export interface ToolExecutionContext extends StoppableContext {
  toolCall: IToolCall
  loop: LoopContext
}

export interface ToolResultContext extends StoppableContext {
  toolCall: IToolCall
  result: IToolResult
  loop: LoopContext
}

export interface ErrorContext extends StoppableContext {
  error: Error
  loop: LoopContext
  phase: 'model_call' | 'tool_execution' | 'stream'
}

export type Middleware<T> = (ctx: T) => Promise<void>

export interface MiddlewareConfig {
  beforeLoopBegin: Middleware<LoopContext>[]
  beforeModelCall: Middleware<ModelCallContext>[]
  onStreamChunk: Middleware<StreamChunkContext>[]
  beforeToolExecution: Middleware<ToolExecutionContext>[]
  afterToolExecution: Middleware<ToolResultContext>[]
  afterModelResponse: Middleware<ModelCallContext>[]
  afterLoopIteration: Middleware<LoopContext>[]
  afterLoopComplete: Middleware<LoopContext>[]
  onError: Middleware<ErrorContext>[]
}
