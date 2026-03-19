import { errorMessage, withRetry } from '../utils/errors'
import type { IProvider, IMessage, IToolCall, TokenUsage } from '../providers/types'
import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext, StoppableContext } from './types'
import { runMiddlewareChain } from './middleware'
import type { ToolRegistry } from './tool-registry'
import { createCompactionMiddleware, forceCompact, isContextLengthError, type CompactionConfig } from './context-compaction'
import { accumulateUsage, parseToolArguments } from '../providers/utils'
import { withTimeout } from './timeout'
import { randomUUID } from 'node:crypto'
import { type Logger, NoopLogger } from '../observability/logger'

export interface AgentLoopOptions {
  provider: IProvider
  tools: ToolRegistry
  maxIterations?: number
  model?: string
  middleware?: Partial<MiddlewareConfig>
  sessionId?: string
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  toolTimeout?: number
  logger?: Logger
  /** Max retries for transient provider errors (rate limits, server errors, network). Default 3. */
  maxRetries?: number
  /** Max characters for a single tool response. Responses exceeding this are truncated with a notice. Default 75000. */
  maxToolResponseSize?: number
}

export interface LoopResult {
  messages: IMessage[]
  iterations: number
  usage: TokenUsage
  stopReason?: string
}

function emptyMiddleware(): MiddlewareConfig {
  return {
    beforeLoopBegin: [], beforeModelCall: [], onStreamChunk: [],
    beforeToolExecution: [], afterToolExecution: [], afterModelResponse: [],
    afterLoopIteration: [], afterLoopComplete: [], onError: [],
  }
}

const DEFAULT_MAX_ITERATIONS = 10
const DEFAULT_MAX_RETRIES = 3
const MAX_COMPACTION_RETRIES = 3
const DEFAULT_MAX_TOOL_RESPONSE_SIZE = 75_000

/** Truncate tool output that exceeds maxChars, appending a notice for the model. */
export function truncateToolOutput(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  const truncated = content.slice(0, maxChars)
  // Try to cut at a newline boundary to avoid splitting a line
  const lastNewline = truncated.lastIndexOf('\n')
  const cutPoint = lastNewline > maxChars * 0.8 ? lastNewline : maxChars
  return content.slice(0, cutPoint) +
    `\n\n<response clipped>\nOutput truncated: ${content.length.toLocaleString()} chars exceeded limit of ${maxChars.toLocaleString()}. ` +
    'Use more targeted queries (e.g. offset/limit, specific paths, narrower search patterns) to get the information you need.'
}

export class AgentLoop {
  private provider: IProvider
  private tools: ToolRegistry
  private maxIterations: number
  private model: string
  private middleware: MiddlewareConfig
  private sessionId: string
  private thinking: 'low' | 'medium' | 'high' | undefined
  private toolTimeout: number
  private logger: Logger
  private compactionConfig: CompactionConfig | undefined
  private maxRetries: number
  private maxToolResponseSize: number
  private externalAbort: AbortController | null = null

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
    this.model = options.model ?? 'default'
    this.sessionId = options.sessionId ?? randomUUID()
    this.middleware = { ...emptyMiddleware(), ...options.middleware }
    this.thinking = options.thinking
    this.toolTimeout = options.toolTimeout ?? 0
    this.logger = options.logger ?? new NoopLogger()
    this.compactionConfig = options.compaction?.enabled ? options.compaction : undefined
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.maxToolResponseSize = options.maxToolResponseSize ?? DEFAULT_MAX_TOOL_RESPONSE_SIZE
    if (options.compaction?.enabled) {
      this.middleware.beforeModelCall.unshift(
        createCompactionMiddleware(this.provider, options.compaction),
      )
    }
  }

  abort(): void {
    this.externalAbort?.abort()
  }

  async run(initialMessages: IMessage[], _compactionRetries = 0): Promise<LoopResult> {
    const messages = initialMessages
    let iterations = 0
    const controller = new AbortController()
    this.externalAbort = controller
    let stopReason: string | undefined
    let stoppedInternally = false
    const stop = (reason?: string) => {
      stoppedInternally = true
      stopReason = reason
      if (reason) this.logger.info('loop stopped', { reason })
      controller.abort()
    }
    const { signal } = controller

    const stoppable: StoppableContext = { stop, signal, logger: this.logger }

    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    let lastUsage: TokenUsage | undefined

    const loopCtx = (): LoopContext => ({ ...stoppable, messages, iteration: iterations, maxIterations: this.maxIterations, sessionId: this.sessionId, usage, lastUsage })

    let currentPhase: 'model_call' | 'tool_execution' | 'stream' = 'model_call'

    try {
      await runMiddlewareChain(loopCtx(), this.middleware.beforeLoopBegin, this.toolTimeout)
      if (signal.aborted) return { messages, iterations, usage, ...(stopReason && { stopReason }) }

      while (iterations < this.maxIterations) {
        iterations++

        const request = {
          model: this.model,
          messages,
          tools: this.tools.all(),
          ...(this.thinking && { thinking: this.thinking }),
          signal,
        }
        const modelCallCtx: ModelCallContext = { ...stoppable, request, loop: loopCtx() }
        await runMiddlewareChain(modelCallCtx, this.middleware.beforeModelCall, this.toolTimeout)
        if (signal.aborted) break

        let textAccumulator = ''
        const toolCallBuf: { id: string; name: string; argsRaw: string }[] = []

        currentPhase = 'stream'
        await withRetry(async () => {
          for await (const chunk of this.provider.stream(request)) {
            if (chunk.type === 'done') {
              if (chunk.usage) { accumulateUsage(usage, chunk.usage); lastUsage = chunk.usage }
              break
            }

            // All non-done chunks go through middleware + abort check
            await runMiddlewareChain({ ...stoppable, chunk, loop: loopCtx() } satisfies StreamChunkContext, this.middleware.onStreamChunk, this.toolTimeout)
            if (signal.aborted) break

            // Accumulate stream data
            if (chunk.type === 'text') textAccumulator += chunk.delta
            else if (chunk.type === 'tool_call_start') toolCallBuf.push({ id: chunk.id, name: chunk.name, argsRaw: '' })
            else if (chunk.type === 'tool_call_delta') { const tc = toolCallBuf.find(t => t.id === chunk.id); if (tc) tc.argsRaw += chunk.argsDelta }
          }
        }, {
          maxRetries: this.maxRetries,
          signal,
          onRetry: (error, attempt) => {
            // Reset accumulators on retry since the stream will restart
            textAccumulator = ''
            toolCallBuf.length = 0
            this.logger.info('provider error, retrying', { category: error.category, attempt, maxRetries: this.maxRetries, error: error.message })
          },
        })

        if (signal.aborted) break

        const toolCalls: IToolCall[] = toolCallBuf.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.argsRaw }))
        messages.push({ role: 'assistant', content: textAccumulator, ...(toolCalls.length && { toolCalls }) })
        modelCallCtx.loop = loopCtx()
        await runMiddlewareChain(modelCallCtx, this.middleware.afterModelResponse, this.toolTimeout)
        if (signal.aborted) break

        if (toolCalls.length) {
          currentPhase = 'tool_execution'
          for (const tc of toolCalls) {
            if (signal.aborted) break
            let denied: string | undefined
            const toolExecCtx: ToolExecutionContext = { ...stoppable, toolCall: tc, loop: loopCtx(), deny: (r) => { denied = r } }
            await runMiddlewareChain(toolExecCtx, this.middleware.beforeToolExecution, this.toolTimeout)
            if (signal.aborted) break
            if (denied) {
              messages.push({ role: 'tool', content: denied, toolCallId: tc.id, isError: true })
              continue
            }
            const input = parseToolArguments(tc.arguments || '{}')
            let content: string
            let isError = false
            try {
              const value = this.toolTimeout > 0
                ? await withTimeout(this.tools.execute(tc.name, input), this.toolTimeout, `Tool '${tc.name}'`)
                : await this.tools.execute(tc.name, input)
              content = typeof value === 'string' ? value : JSON.stringify(value)
              content = truncateToolOutput(content, this.maxToolResponseSize)
              // Roll up child usage (e.g. from subagent tool) into parent totals
              if (value && typeof value === 'object' && 'usage' in value) {
                const childUsage = (value as { usage: TokenUsage }).usage
                if (childUsage) accumulateUsage(usage, childUsage)
              }
            } catch (err) {
              isError = true
              content = errorMessage(err)
            }
            await runMiddlewareChain({ ...stoppable, toolCall: tc, result: { toolCallId: tc.id, content, isError }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution, this.toolTimeout)
            messages.push({ role: 'tool', content, toolCallId: tc.id, ...(isError && { isError: true }) })
          }
          currentPhase = 'model_call'
        }

        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopIteration, this.toolTimeout)
        if (signal.aborted) break
        if (!toolCalls.length) break
      }

      if (!signal.aborted) {
        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopComplete, this.toolTimeout)
      }
    } catch (err) {
      // If the loop was aborted (e.g. Ctrl+C), swallow the error and return partial results
      if (signal.aborted) {
        this.externalAbort = null
        return { messages, iterations, usage, stopReason: stopReason ?? 'aborted' }
      }
      // Attempt recovery via compaction when a provider rejects due to context length.
      if (this.compactionConfig && currentPhase === 'stream' && isContextLengthError(err) && _compactionRetries < MAX_COMPACTION_RETRIES) {
        const modelCallCtx: ModelCallContext = {
          ...stoppable,
          request: { model: this.model, messages, tools: this.tools.all(), ...(this.thinking && { thinking: this.thinking }), signal },
          loop: loopCtx(),
        }
        const compacted = await forceCompact(this.provider, this.compactionConfig, modelCallCtx)
        if (compacted) {
          this.externalAbort = null
          return this.run(messages, _compactionRetries + 1)
        }
      }
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain({ ...stoppable, error, loop: loopCtx(), phase: currentPhase } satisfies ErrorContext, this.middleware.onError, this.toolTimeout)
      throw err
    }

    this.externalAbort = null
    const finalReason = stopReason ?? (signal.aborted && !stoppedInternally ? 'aborted' : undefined)
    return { messages, iterations, usage, ...(finalReason && { stopReason: finalReason }) }
  }
}
