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
  const lastNewline = truncated.lastIndexOf('\n')
  const cutPoint = lastNewline > maxChars * 0.8 ? lastNewline : maxChars
  return content.slice(0, cutPoint) +
    `\n\n<response clipped>\nOutput truncated: ${content.length.toLocaleString()} chars exceeded limit of ${maxChars.toLocaleString()}. ` +
    'Use more targeted queries (e.g. offset/limit, specific paths, narrower search patterns) to get the information you need.'
}

/** Mutable context shared across all tool execution methods within a single run(). */
interface ToolExecEnv {
  stoppable: StoppableContext
  ctx: LoopContext
  usage: TokenUsage
  signal: AbortSignal
  messages: IMessage[]
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

    // Mutable context — updated in place to avoid repeated object creation
    const ctx: LoopContext = {
      ...stoppable, messages, iteration: 0, maxIterations: this.maxIterations,
      sessionId: this.sessionId, usage, lastUsage: undefined, resumed: this.resumed, elapsedMs: 0,
    }
    const refreshCtx = () => { ctx.iteration = iterations; ctx.lastUsage = lastUsage; ctx.elapsedMs = Date.now() - startTime }

    let currentPhase: 'model_call' | 'tool_execution' | 'stream' = 'model_call'

    this.logger.debug('loop starting', { maxIterations: this.maxIterations, model: this.model, sessionId: this.sessionId, messageCount: messages.length })

    try {
      refreshCtx()
      await runMiddlewareChain(ctx, this.middleware.beforeLoopBegin, this.toolTimeout)
      if (signal.aborted) return { messages, iterations, usage, ...(stopReason && { stopReason }) }

      while (iterations < this.maxIterations) {
        if (draining) {
          this.logger.info('loop stopped gracefully', { iteration: iterations, reason: stopReason })
          break
        }

        const now = Date.now() - startTime
        if (this.maxDuration > 0 && now >= this.maxDuration) {
          stopReason = 'max_duration'
          this.logger.info('loop max duration reached', { elapsedMs: now, maxDuration: this.maxDuration })
          break
        }

        if (this.tokenBudget > 0 && (usage.inputTokens + usage.outputTokens) >= this.tokenBudget) {
          stopReason = 'token_budget'
          this.logger.info('loop token budget exceeded', { totalTokens: usage.inputTokens + usage.outputTokens, tokenBudget: this.tokenBudget })
          break
        }

        iterations++
        refreshCtx()
        this.logger.debug('iteration starting', { iteration: iterations, messageCount: messages.length })

        const request = {
          model: this.model,
          messages,
          tools: this.tools.all(),
          ...(this.thinking && { thinking: this.thinking }),
          signal,
        }
        const modelCallCtx: ModelCallContext = { ...stoppable, request, loop: ctx }
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

            await runMiddlewareChain({ ...stoppable, chunk, loop: ctx } satisfies StreamChunkContext, this.middleware.onStreamChunk, this.toolTimeout)
            if (signal.aborted) break

            if (chunk.type === 'text') textAccumulator += chunk.delta
            else if (chunk.type === 'tool_call_start') toolCallBuf.push({ id: chunk.id, name: chunk.name, argsRaw: '' })
            else if (chunk.type === 'tool_call_delta') { const tc = toolCallBuf.find(t => t.id === chunk.id); if (tc) tc.argsRaw += chunk.argsDelta }
          }
        }, {
          maxRetries: this.maxRetries,
          signal,
          onRetry: (error, attempt) => {
            textAccumulator = ''
            toolCallBuf.length = 0
            this.logger.info('provider error, retrying', { category: error.category, attempt, maxRetries: this.maxRetries, error: error.message })
          },
        })

        if (signal.aborted) break

        const toolCalls: IToolCall[] = toolCallBuf.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.argsRaw }))
        messages.push({ role: 'assistant', content: textAccumulator, ...(toolCalls.length && { toolCalls }) })
        refreshCtx()
        modelCallCtx.loop = ctx
        await runMiddlewareChain(modelCallCtx, this.middleware.afterModelResponse, this.toolTimeout)
        this.emitProgress(iterations, usage, messages, startTime, 'model_response')
        if (signal.aborted) break

        if (toolCalls.length) {
          currentPhase = 'tool_execution'
          const env: ToolExecEnv = { stoppable, ctx, usage, signal, messages }

          if (this.parallelToolCalls) {
            await this.executeToolsParallel(toolCalls, env)
          } else {
            await this.executeToolsSequential(toolCalls, env)
          }

          this.emitProgress(iterations, usage, messages, startTime, 'tool_execution')
          currentPhase = 'model_call'
        }

        refreshCtx()
        await runMiddlewareChain(ctx, this.middleware.afterLoopIteration, this.toolTimeout)
        this.emitProgress(iterations, usage, messages, startTime, 'iteration_complete')
        if (signal.aborted) break
        if (!toolCalls.length) break
      }

      if (!signal.aborted) {
        refreshCtx()
        await runMiddlewareChain(ctx, this.middleware.afterLoopComplete, this.toolTimeout)
      }
    } catch (err) {
      if (signal.aborted) {
        this.externalAbort = null
        return { messages, iterations, usage, stopReason: stopReason ?? 'aborted' }
      }
      if (this.compactionConfig && currentPhase === 'stream' && isContextLengthError(err) && _compactionRetries < MAX_COMPACTION_RETRIES) {
        this.logger.info('context length exceeded, attempting compaction recovery', { attempt: _compactionRetries + 1, maxRetries: MAX_COMPACTION_RETRIES })
        refreshCtx()
        const modelCallCtx: ModelCallContext = {
          ...stoppable,
          request: { model: this.model, messages, tools: this.tools.all(), ...(this.thinking && { thinking: this.thinking }), signal },
          loop: ctx,
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
      refreshCtx()
      await runMiddlewareChain({ ...stoppable, error, loop: ctx, phase: currentPhase } satisfies ErrorContext, this.middleware.onError, this.toolTimeout)
      throw err
    }

    this.externalAbort = null
    const finalReason = stopReason ?? (signal.aborted && !stoppedInternally ? 'aborted' : undefined)
    return { messages, iterations, usage, ...(finalReason && { stopReason: finalReason }) }
  }

  /** Run beforeToolExecution middleware and return the parsed input, or a denial message. */
  private async approveTool(tc: IToolCall, env: ToolExecEnv): Promise<{ input: Record<string, unknown> } | { denied: string }> {
    let denied: string | undefined
    const toolExecCtx: ToolExecutionContext = { ...env.stoppable, toolCall: tc, loop: env.ctx, deny: (r) => { denied = r } }
    await runMiddlewareChain(toolExecCtx, this.middleware.beforeToolExecution, this.toolTimeout)
    if (denied) {
      this.logger.info('tool call denied', { tool: tc.name, toolCallId: tc.id, reason: denied })
      return { denied }
    }
    return { input: parseToolArguments(tc.arguments || '{}') }
  }

  /** Emit afterToolExecution middleware + checkpoint for a completed tool result. */
  private async finalizeToolResult(tc: IToolCall, content: string, isError: boolean, env: ToolExecEnv): Promise<void> {
    await runMiddlewareChain(
      { ...env.stoppable, toolCall: tc, result: { toolCallId: tc.id, content, isError }, loop: env.ctx } satisfies ToolResultContext,
      this.middleware.afterToolExecution, this.toolTimeout,
    )
    env.messages.push({ role: 'tool', content, toolCallId: tc.id, ...(isError && { isError: true }) })
    if (this.onCheckpoint) {
      this.onCheckpoint({ toolCallId: tc.id, toolName: tc.name, content, isError, messages: env.messages })
    }
  }

  private async executeToolsSequential(toolCalls: IToolCall[], env: ToolExecEnv): Promise<void> {
    for (const tc of toolCalls) {
      if (env.signal.aborted) break
      const approval = await this.approveTool(tc, env)
      if (env.signal.aborted) break
      if ('denied' in approval) {
        env.messages.push({ role: 'tool', content: approval.denied, toolCallId: tc.id, isError: true })
        continue
      }
      let content: string
      let isError = false
      try {
        const result = await this.executeToolCall(tc, approval.input, env)
        content = result.content
      } catch (err) {
        isError = true
        content = errorMessage(err)
      }
      await this.finalizeToolResult(tc, content, isError, env)
    }
  }

  private async executeToolsParallel(toolCalls: IToolCall[], env: ToolExecEnv): Promise<void> {
    // Middleware runs sequentially to preserve ordering-dependent denials,
    // then approved calls execute concurrently.
    const approved: { tc: IToolCall; input: Record<string, unknown> }[] = []
    for (const tc of toolCalls) {
      if (env.signal.aborted) break
      const result = await this.approveTool(tc, env)
      if (env.signal.aborted) break
      if ('denied' in result) {
        env.messages.push({ role: 'tool', content: result.denied, toolCallId: tc.id, isError: true })
        continue
      }
      approved.push({ tc, input: result.input })
    }

    if (!approved.length || env.signal.aborted) return

    const results = await Promise.allSettled(
      approved.map(({ tc, input }) => this.executeToolCall(tc, input, env)),
    )

    for (let i = 0; i < approved.length; i++) {
      const { tc } = approved[i]!
      const settled = results[i]!
      const content = settled.status === 'fulfilled' ? settled.value.content : errorMessage(settled.reason)
      const isError = settled.status === 'rejected'
      await this.finalizeToolResult(tc, content, isError, env)
    }
  }

  /** Execute a single tool call with timeout, heartbeat, truncation, and child usage rollup. */
  private async executeToolCall(
    tc: IToolCall,
    input: Record<string, unknown>,
    env: Pick<ToolExecEnv, 'usage' | 'signal'>,
  ): Promise<{ content: string }> {
    const toolDef = this.tools.get(tc.name)
    const effectiveTimeout = toolDef?.timeout ?? this.toolTimeout
    const execOptions: ToolExecuteOptions = { heartbeat: () => {}, signal: env.signal }

    const executePromise = this.heartbeatTimeout > 0
      ? this.executeWithHeartbeat(tc.name, input, execOptions, this.heartbeatTimeout)
      : this.tools.execute(tc.name, input, execOptions)

    const value = effectiveTimeout > 0
      ? await withTimeout(executePromise, effectiveTimeout, `Tool '${tc.name}'`)
      : await executePromise

    let content = typeof value === 'string' ? value : JSON.stringify(value)
    const originalLength = content.length
    content = truncateToolOutput(content, this.maxToolResponseSize)
    if (content.length !== originalLength) {
      this.logger.warn('tool output truncated', { tool: tc.name, toolCallId: tc.id, originalLength, maxChars: this.maxToolResponseSize })
    }

    if (value && typeof value === 'object' && 'usage' in value) {
      const childUsage = (value as { usage: TokenUsage }).usage
      if (childUsage) accumulateUsage(env.usage, childUsage)
    }

    return { content }
  }

  private executeWithHeartbeat(
    toolName: string,
    input: Record<string, unknown>,
    execOptions: ToolExecuteOptions,
    heartbeatMs: number,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      let settled = false

      const resetTimer = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          settled = true
          reject(new Error(`Tool '${toolName}' heartbeat timeout: no heartbeat received within ${heartbeatMs}ms`))
        }, heartbeatMs)
      }

      execOptions.heartbeat = () => {
        if (settled) return
        this.logger.debug('tool heartbeat received', { tool: toolName })
        resetTimer()
      }

      resetTimer()

      this.tools.execute(toolName, input, execOptions).then(
        (value) => { settled = true; clearTimeout(timer); resolve(value) },
        (err) => { settled = true; clearTimeout(timer); reject(err) },
      )
    })
  }

  private emitProgress(iteration: number, usage: TokenUsage, messages: IMessage[], startTime: number, phase: ProgressInfo['phase']): void {
    if (!this.onProgress) return
    this.onProgress({ iteration, maxIterations: this.maxIterations, usage, elapsedMs: Date.now() - startTime, messages, phase })
  }
}
