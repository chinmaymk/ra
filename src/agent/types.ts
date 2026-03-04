import type { IToolCall, IToolResult, StreamChunk, IMessage, ChatRequest } from '../providers/types'

export interface LoopContext {
  messages: IMessage[]
  iteration: number
  maxIterations: number
  sessionId: string
}

export interface ModelCallContext {
  request: ChatRequest
  loop: LoopContext
}

export interface StreamChunkContext {
  chunk: StreamChunk
  loop: LoopContext
}

export interface ToolExecutionContext {
  toolCall: IToolCall
  loop: LoopContext
}

export interface ToolResultContext {
  toolCall: IToolCall
  result: IToolResult
  loop: LoopContext
}

export interface ErrorContext {
  error: Error
  loop: LoopContext
  phase: 'model_call' | 'tool_execution' | 'stream'
}

export type Middleware<T> = (ctx: T, next: () => Promise<void>) => Promise<void>

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
