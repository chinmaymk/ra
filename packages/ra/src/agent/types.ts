import type { IToolCall, IToolResult, StreamChunk, IMessage, ChatRequest, TokenUsage } from '../providers/types'
import type { Logger } from '../observability/logger'

export interface StoppableContext {
  stop: (reason?: string) => void
  /** Request graceful shutdown: finish the current iteration, then stop. */
  drain: (reason?: string) => void
  signal: AbortSignal
  logger: Logger
}

export interface LoopContext extends StoppableContext {
  messages: IMessage[]
  iteration: number
  maxIterations: number
  sessionId: string
  usage: TokenUsage
  lastUsage: TokenUsage | undefined
  /** True when this loop is running against a resumed session (prior messages loaded from storage). */
  resumed: boolean
  /** Elapsed wall-clock time in milliseconds since loop.run() was called. */
  elapsedMs: number
}

/** Progress snapshot emitted via onProgress callback. */
export interface ProgressInfo {
  iteration: number
  maxIterations: number
  usage: TokenUsage
  elapsedMs: number
  messages: IMessage[]
  /** Which phase just completed. */
  phase: 'model_response' | 'tool_execution' | 'iteration_complete'
}

/** Callback to receive incremental tool results for mid-execution checkpointing. */
export interface CheckpointEvent {
  toolCallId: string
  toolName: string
  content: string
  isError: boolean
  /** The full message array at the time of checkpoint. */
  messages: IMessage[]
}

/** Heartbeat callback for long-running tools. Tools call this to signal liveness. */
export type HeartbeatFn = () => void

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
  /** Reject this tool call without stopping the loop. The reason is returned to the model as an error result. */
  deny: (reason: string) => void
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
