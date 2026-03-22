import { errorMessage, withRetry } from '../utils/errors'
import type { IProvider, IMessage, IToolCall, TokenUsage, ToolExecuteOptions } from '../providers/types'
import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext, StoppableContext, StopOptions, ProgressInfo, CheckpointEvent } from './types'
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
  /** Max characters for a single tool response. Responses exceeding this are truncated with a notice. Default 25000. */
  maxToolResponseSize?: number
  /** True when the loop is running against a resumed session (prior messages loaded from storage). */
  resumed?: boolean
  /** Execute tool calls in parallel when multiple are returned by the model. Default false. */
  parallelToolCalls?: boolean
  /** Maximum total token budget (input + output). Loop stops when exceeded. */
  tokenBudget?: number
  /** Maximum wall-clock duration in ms for the entire loop. */
  maxDuration?: number
  /** Called at natural milestones (after model response, tool execution, iteration). */
  onProgress?: (info: ProgressInfo) => void
  /** Called after each tool result is produced, before the iteration ends. Enables incremental checkpointing. */
  onCheckpoint?: (event: CheckpointEvent) => void
  /** Liveness timeout in ms for tool execution. If a tool doesn't heartbeat within this window, it's considered hung. 0 = disabled. Default 0. */
  heartbeatTimeout?: number
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
const DEFAULT_MAX_TOOL_RESPONSE_SIZE = 25_000

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
  private resumed: boolean
  private parallelToolCalls: boolean
  private tokenBudget: number
  private maxDuration: number
  private onProgress: ((info: ProgressInfo) => void) | undefined
  private onCheckpoint: ((event: CheckpointEvent) => void) | undefined
  private heartbeatTimeout: number

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
    this.resumed = options.resumed ?? false
    this.compactionConfig = options.compaction?.enabled ? options.compaction : undefined
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.maxToolResponseSize = options.maxToolResponseSize ?? DEFAULT_MAX_TOOL_RESPONSE_SIZE
    this.parallelToolCalls = options.parallelToolCalls ?? false
    this.tokenBudget = options.tokenBudget ?? 0
    this.maxDuration = options.maxDuration ?? 0
    this.onProgress = options.onProgress
    this.onCheckpoint = options.onCheckpoint
    this.heartbeatTimeout = options.heartbeatTimeout ?? 0

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
    let draining = false
    const startTime = Date.now()

    const stop = (reason?: string, options?: StopOptions) => {
      stoppedInternally = true
      stopReason = reason
      if (options?.immediate) {
        if (reason) this.logger.info('loop stopped immediately', { reason })
        controller.abort()
      } else {
        draining = true
        if (reason) this.logger.info('loop stopping', { reason })
      }
    }

    const { signal } = controller

    const stoppable: StoppableContext = { stop, signal, logger: this.logger }

    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    let lastUsage: TokenUsage | undefined

    const elapsed = () => Date.now() - startTime

    const loopCtx = (): LoopContext => ({ ...stoppable, messages, iteration: iterations, maxIterations: this.maxIterations, sessionId: this.sessionId, usage, lastUsage, resumed: this.resumed, elapsedMs: elapsed() })

    const emitProgress = (phase: ProgressInfo['phase']) => {
      if (!this.onProgress) return
      this.onProgress({ iteration: iterations, maxIterations: this.maxIterations, usage: { ...usage }, elapsedMs: elapsed(), messages, phase })
    }

    let currentPhase: 'model_call' | 'tool_execution' | 'stream' = 'model_call'

    this.logger.debug('loop starting', { maxIterations: this.maxIterations, model: this.model, sessionId: this.sessionId, messageCount: messages.length })

    try {
      await runMiddlewareChain(loopCtx(), this.middleware.beforeLoopBegin, this.toolTimeout)
      if (signal.aborted) return { messages, iterations, usage, ...(stopReason && { stopReason }) }

      while (iterations < this.maxIterations) {
        // Check graceful stop flag at iteration boundary
        if (draining) {
          this.logger.info('loop stopped gracefully', { iteration: iterations, reason: stopReason })
          break
        }

        // Check maxDuration
        if (this.maxDuration > 0 && elapsed() >= this.maxDuration) {
          stopReason = 'max_duration'
          this.logger.info('loop max duration reached', { elapsedMs: elapsed(), maxDuration: this.maxDuration })
          break
        }

        // Check token budget
        if (this.tokenBudget > 0 && (usage.inputTokens + usage.outputTokens) >= this.tokenBudget) {
          stopReason = 'token_budget'
          this.logger.info('loop token budget exceeded', { totalTokens: usage.inputTokens + usage.outputTokens, tokenBudget: this.tokenBudget })
          break
        }

        iterations++
        this.logger.debug('iteration starting', { iteration: iterations, messageCount: messages.length })

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
        emitProgress('model_response')
        if (signal.aborted) break

        if (toolCalls.length) {
          currentPhase = 'tool_execution'

          if (this.parallelToolCalls) {
            await this.executeToolsParallel(toolCalls, messages, stoppable, loopCtx, usage, signal)
          } else {
            await this.executeToolsSequential(toolCalls, messages, stoppable, loopCtx, usage, signal)
          }

          emitProgress('tool_execution')
          currentPhase = 'model_call'
        }

        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopIteration, this.toolTimeout)
        emitProgress('iteration_complete')
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
        this.logger.info('context length exceeded, attempting compaction recovery', { attempt: _compactionRetries + 1, maxRetries: MAX_COMPACTION_RETRIES })
        const modelCallCtx: ModelCallContext = {
          ...stoppable,
          request: { model: this.model, messages, tools: this.tools.all(), ...(this.thinking && { thinking: this.thinking }), signal },
          loop: loopCtx(),
        }
        const compacted = await forceCompact(this.provider, this.compactionConfig, modelCallCtx)
        if (compacted) {
          this.logger.info('compaction recovery succeeded, restarting loop', { messageCount: messages.length, attempt: _compactionRetries + 1 })
          this.externalAbort = null
          return this.run(messages, _compactionRetries + 1)
        }
        this.logger.error('compaction recovery failed', { attempt: _compactionRetries + 1 })
      }
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain({ ...stoppable, error, loop: loopCtx(), phase: currentPhase } satisfies ErrorContext, this.middleware.onError, this.toolTimeout)
      throw err
    }

    this.externalAbort = null
    const finalReason = stopReason ?? (signal.aborted && !stoppedInternally ? 'aborted' : undefined)
    return { messages, iterations, usage, ...(finalReason && { stopReason: finalReason }) }
  }

  /** Execute tool calls one at a time. */
  private async executeToolsSequential(
    toolCalls: IToolCall[],
    messages: IMessage[],
    stoppable: StoppableContext,
    loopCtx: () => LoopContext,
    usage: TokenUsage,
    signal: AbortSignal,
  ): Promise<void> {
    for (const tc of toolCalls) {
      if (signal.aborted) break
      const result = await this.executeSingleTool(tc, messages, stoppable, loopCtx, usage, signal)
      if (result) messages.push(result)
    }
  }

  /** Execute tool calls concurrently with Promise.allSettled. */
  private async executeToolsParallel(
    toolCalls: IToolCall[],
    messages: IMessage[],
    stoppable: StoppableContext,
    loopCtx: () => LoopContext,
    usage: TokenUsage,
    signal: AbortSignal,
  ): Promise<void> {
    // Run beforeToolExecution middleware sequentially (may have ordering dependencies)
    // then execute the actual tool calls in parallel
    const approved: { tc: IToolCall; input: Record<string, unknown> }[] = []
    for (const tc of toolCalls) {
      if (signal.aborted) break
      let denied: string | undefined
      const toolExecCtx: ToolExecutionContext = { ...stoppable, toolCall: tc, loop: loopCtx(), deny: (r) => { denied = r } }
      await runMiddlewareChain(toolExecCtx, this.middleware.beforeToolExecution, this.toolTimeout)
      if (signal.aborted) break
      if (denied) {
        this.logger.info('tool call denied', { tool: tc.name, toolCallId: tc.id, reason: denied })
        messages.push({ role: 'tool', content: denied, toolCallId: tc.id, isError: true })
        continue
      }
      approved.push({ tc, input: parseToolArguments(tc.arguments || '{}') })
    }

    if (!approved.length || signal.aborted) return

    const results = await Promise.allSettled(
      approved.map(({ tc, input }) => this.executeToolCall(tc, input, usage, signal)),
    )

    // Collect results in order, preserving tool call ordering for determinism
    for (let i = 0; i < approved.length; i++) {
      const entry = approved[i]!
      const settled = results[i]!
      let content: string
      let isError = false

      if (settled.status === 'fulfilled') {
        content = settled.value.content
        isError = settled.value.isError
      } else {
        isError = true
        content = errorMessage(settled.reason)
      }

      await runMiddlewareChain({ ...stoppable, toolCall: entry.tc, result: { toolCallId: entry.tc.id, content, isError }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution, this.toolTimeout)
      messages.push({ role: 'tool', content, toolCallId: entry.tc.id, ...(isError && { isError: true }) })

      if (this.onCheckpoint) {
        this.onCheckpoint({ toolCallId: entry.tc.id, toolName: entry.tc.name, content, isError, messages })
      }
    }
  }

  /** Execute a single tool including middleware, and push the result message. Returns the message or undefined if aborted. */
  private async executeSingleTool(
    tc: IToolCall,
    messages: IMessage[],
    stoppable: StoppableContext,
    loopCtx: () => LoopContext,
    usage: TokenUsage,
    signal: AbortSignal,
  ): Promise<IMessage | undefined> {
    let denied: string | undefined
    const toolExecCtx: ToolExecutionContext = { ...stoppable, toolCall: tc, loop: loopCtx(), deny: (r) => { denied = r } }
    await runMiddlewareChain(toolExecCtx, this.middleware.beforeToolExecution, this.toolTimeout)
    if (signal.aborted) return undefined
    if (denied) {
      this.logger.info('tool call denied', { tool: tc.name, toolCallId: tc.id, reason: denied })
      return { role: 'tool', content: denied, toolCallId: tc.id, isError: true }
    }

    const input = parseToolArguments(tc.arguments || '{}')
    let content: string
    let isError = false

    try {
      const result = await this.executeToolCall(tc, input, usage, signal)
      content = result.content
      isError = result.isError
    } catch (err) {
      isError = true
      content = errorMessage(err)
    }

    await runMiddlewareChain({ ...stoppable, toolCall: tc, result: { toolCallId: tc.id, content, isError }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution, this.toolTimeout)

    const msg: IMessage = { role: 'tool', content, toolCallId: tc.id, ...(isError && { isError: true }) }

    if (this.onCheckpoint) {
      // Pass messages + new message for checkpointing before it's formally added
      this.onCheckpoint({ toolCallId: tc.id, toolName: tc.name, content, isError, messages: [...messages, msg] })
    }

    return msg
  }

  /** Low-level tool execution: timeout, heartbeat, truncation, child usage rollup. */
  private async executeToolCall(
    tc: IToolCall,
    input: Record<string, unknown>,
    usage: TokenUsage,
    signal: AbortSignal,
  ): Promise<{ content: string; isError: boolean }> {
    const toolDef = this.tools.get(tc.name)
    const effectiveTimeout = toolDef?.timeout ?? this.toolTimeout

    const execOptions: ToolExecuteOptions = {
      heartbeat: () => {},  // default no-op, replaced below if heartbeatTimeout is set
      signal,
    }

    // Heartbeat-aware execution: wraps the tool call with a liveness timer
    let executePromise: Promise<unknown>
    if (this.heartbeatTimeout > 0) {
      executePromise = this.executeWithHeartbeat(tc.name, input, execOptions, this.heartbeatTimeout)
    } else {
      executePromise = this.tools.execute(tc.name, input, execOptions)
    }

    const value = effectiveTimeout > 0
      ? await withTimeout(executePromise, effectiveTimeout, `Tool '${tc.name}'`)
      : await executePromise

    let content = typeof value === 'string' ? value : JSON.stringify(value)
    const originalLength = content.length
    content = truncateToolOutput(content, this.maxToolResponseSize)
    if (content.length !== originalLength) {
      this.logger.warn('tool output truncated', { tool: tc.name, toolCallId: tc.id, originalLength, maxChars: this.maxToolResponseSize })
    }

    // Roll up child usage (e.g. from subagent tool) into parent totals
    if (value && typeof value === 'object' && 'usage' in value) {
      const childUsage = (value as { usage: TokenUsage }).usage
      if (childUsage) accumulateUsage(usage, childUsage)
    }

    return { content, isError: false }
  }

  /** Execute a tool with heartbeat liveness monitoring. Rejects if heartbeat isn't called within the timeout. */
  private executeWithHeartbeat(
    toolName: string,
    input: Record<string, unknown>,
    execOptions: ToolExecuteOptions,
    heartbeatMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>

      const resetTimer = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          reject(new Error(`Tool '${toolName}' heartbeat timeout: no heartbeat received within ${heartbeatMs}ms`))
        }, heartbeatMs)
      }

      // Set up the heartbeat function
      execOptions.heartbeat = () => {
        this.logger.debug('tool heartbeat received', { tool: toolName })
        resetTimer()
      }

      // Start the initial liveness timer
      resetTimer()

      this.tools.execute(toolName, input, execOptions).then(
        (value) => { clearTimeout(timer); resolve(value) },
        (err) => { clearTimeout(timer); reject(err) },
      )
    })
  }
}
