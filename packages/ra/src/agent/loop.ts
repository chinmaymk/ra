import { errorMessage, withRetry } from '../utils/errors'
import type { IProvider, IMessage, IToolCall, TokenUsage, ThinkingMode, ThinkingLevel } from '../providers/types'
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
  thinking?: ThinkingMode
  /** Absolute cap on thinking budget tokens sent to the provider. */
  thinkingBudgetCap?: number
  compaction?: CompactionConfig
  toolTimeout?: number
  logger?: Logger
  /** Max retries for transient provider errors (rate limits, server errors, network). Default 3. */
  maxRetries?: number
  /** Max characters for a single tool response. Responses exceeding this are truncated with a notice. Default 25000. */
  maxToolResponseSize?: number
  /** True when the loop is running against a resumed session (prior messages loaded from storage). */
  resumed?: boolean
  /** Execute tool calls in parallel when the model returns multiple in a single response. Default true. */
  parallelToolCalls?: boolean
  /** Max total tokens (input + output) before the loop stops. 0 = unlimited. */
  maxTokenBudget?: number
  /** Max wall-clock duration in milliseconds before the loop stops. 0 = unlimited. */
  maxDuration?: number
}

export interface LoopResult {
  messages: IMessage[]
  iterations: number
  usage: TokenUsage
  durationMs: number
  stopReason?: string
}

function emptyMiddleware(): MiddlewareConfig {
  return {
    beforeLoopBegin: [], beforeModelCall: [], onStreamChunk: [],
    beforeToolExecution: [], afterToolExecution: [], afterModelResponse: [],
    afterLoopIteration: [], afterLoopComplete: [], onError: [],
  }
}

const DEFAULT_MAX_ITERATIONS = 0
const DEFAULT_MAX_RETRIES = 3
const MAX_COMPACTION_RETRIES = 3
const DEFAULT_MAX_TOOL_RESPONSE_SIZE = 25_000
const ADAPTIVE_HIGH_TURNS = 10

/** Resolve a ThinkingMode to the concrete ThinkingLevel for a given iteration. */
export function resolveThinking(mode: ThinkingMode | undefined, iteration: number): ThinkingLevel | undefined {
  if (!mode || mode === 'off') return undefined
  if (mode === 'adaptive') return iteration <= ADAPTIVE_HIGH_TURNS ? 'high' : 'low'
  return mode
}

/** Truncate tool output that exceeds maxChars, keeping top and bottom portions with a notice in between. */
export function truncateToolOutput(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  const topSize = Math.floor(maxChars * 0.8)
  const bottomSize = maxChars - topSize
  // Try to cut at newline boundaries to avoid splitting lines
  const topSlice = content.slice(0, topSize)
  const lastNewline = topSlice.lastIndexOf('\n')
  const topEnd = lastNewline > topSize * 0.8 ? lastNewline : topSize
  const bottomSlice = content.slice(-bottomSize)
  const firstNewline = bottomSlice.indexOf('\n')
  const bottomStart = firstNewline >= 0 && firstNewline <= bottomSize * 0.2
    ? content.length - bottomSize + firstNewline + 1
    : content.length - bottomSize
  const omitted = bottomStart - topEnd
  return content.slice(0, topEnd) +
    `\n\n<response clipped>\nOutput truncated: ${omitted.toLocaleString()} chars omitted out of ${content.length.toLocaleString()} total (limit ${maxChars.toLocaleString()}). ` +
    'Use more targeted queries (e.g. offset/limit, specific paths, narrower search patterns) to get the information you need.\n\n' +
    content.slice(bottomStart)
}

export class AgentLoop {
  private provider: IProvider
  private tools: ToolRegistry
  private maxIterations: number
  private model: string
  private middleware: MiddlewareConfig
  private sessionId: string
  private thinking: ThinkingMode | undefined
  private thinkingBudgetCap: number | undefined
  private toolTimeout: number
  private logger: Logger
  private compactionConfig: CompactionConfig | undefined
  private maxRetries: number
  private maxToolResponseSize: number
  private resumed: boolean
  private parallelToolCalls: boolean
  private maxTokenBudget: number
  private maxDuration: number

  private externalAbort: AbortController | null = null

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS
    this.model = options.model ?? 'default'
    this.sessionId = options.sessionId ?? randomUUID()
    this.middleware = { ...emptyMiddleware(), ...options.middleware }
    this.thinking = options.thinking
    this.thinkingBudgetCap = options.thinkingBudgetCap
    this.toolTimeout = options.toolTimeout ?? 0
    this.logger = options.logger ?? new NoopLogger()
    this.resumed = options.resumed ?? false
    this.compactionConfig = options.compaction?.enabled ? options.compaction : undefined
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.maxToolResponseSize = options.maxToolResponseSize ?? DEFAULT_MAX_TOOL_RESPONSE_SIZE
    this.parallelToolCalls = options.parallelToolCalls ?? true
    this.maxTokenBudget = options.maxTokenBudget ?? 0
    this.maxDuration = options.maxDuration ?? 0

    if (options.compaction?.enabled) {
      this.middleware.beforeModelCall.unshift(
        createCompactionMiddleware(this.provider, options.compaction),
      )
    }
  }

  abort(): void {
    this.externalAbort?.abort()
  }

  /** Build a ChatRequest with thinking resolved for the current iteration. */
  private buildRequest(messages: IMessage[], iteration: number, signal: AbortSignal) {
    const thinking = resolveThinking(this.thinking, iteration)
    return {
      model: this.model,
      messages,
      tools: this.tools.all(),
      ...(thinking && { thinking }),
      ...(thinking && this.thinkingBudgetCap && { thinkingBudgetCap: this.thinkingBudgetCap }),
      signal,
    }
  }

  /** Execute a single tool call, running before/after middleware and returning the result message. */
  private async executeSingleTool(
    tc: IToolCall,
    stoppable: StoppableContext,
    loopCtx: () => LoopContext,
    usage: TokenUsage,
  ): Promise<IMessage> {
    let denied: string | undefined
    const toolExecCtx: ToolExecutionContext = { ...stoppable, toolCall: tc, loop: loopCtx(), deny: (r) => { denied = r } }
    await runMiddlewareChain(toolExecCtx, this.middleware.beforeToolExecution, this.toolTimeout)
    if (stoppable.signal.aborted || denied) {
      if (denied) this.logger.info('tool call denied', { tool: tc.name, toolCallId: tc.id, reason: denied })
      const content = denied ?? 'aborted'
      return { role: 'tool', content, toolCallId: tc.id, isError: true }
    }
    const input = parseToolArguments(tc.arguments || '{}')
    let content: string
    let isError = false
    try {
      const toolDef = this.tools.get(tc.name)
      const effectiveTimeout = toolDef?.timeout ?? this.toolTimeout
      const value = await withTimeout(this.tools.execute(tc.name, input), effectiveTimeout, `Tool '${tc.name}'`)
      content = typeof value === 'string' ? value : JSON.stringify(value)
      const originalLength = content.length
      content = truncateToolOutput(content, this.maxToolResponseSize)
      if (content.length !== originalLength) {
        this.logger.warn('tool output truncated', { tool: tc.name, toolCallId: tc.id, originalLength, maxChars: this.maxToolResponseSize })
      }
      if (value && typeof value === 'object' && 'usage' in value) {
        const childUsage = (value as { usage: TokenUsage }).usage
        if (childUsage) accumulateUsage(usage, childUsage)
      }
    } catch (err) {
      isError = true
      content = errorMessage(err)
    }
    await runMiddlewareChain({ ...stoppable, toolCall: tc, result: { toolCallId: tc.id, content, isError }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution, this.toolTimeout)
    return { role: 'tool', content, toolCallId: tc.id, ...(isError && { isError: true }) }
  }

  async run(initialMessages: IMessage[], _compactionRetries = 0, _priorState?: { iterations: number; usage: TokenUsage; startTime: number }): Promise<LoopResult> {
    const startTime = _priorState?.startTime ?? Date.now()
    const messages = initialMessages
    let iterations = _priorState?.iterations ?? 0
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

    const usage: TokenUsage = _priorState?.usage ?? { inputTokens: 0, outputTokens: 0 }
    let lastUsage: TokenUsage | undefined

    const loopCtx = (): LoopContext => ({ ...stoppable, messages, iteration: iterations, maxIterations: this.maxIterations, sessionId: this.sessionId, usage, lastUsage, resumed: this.resumed })

    let currentPhase: 'model_call' | 'tool_execution' | 'stream' = 'model_call'

    this.logger.debug('loop starting', { maxIterations: this.maxIterations, model: this.model, sessionId: this.sessionId, messageCount: messages.length })

    try {
      await runMiddlewareChain(loopCtx(), this.middleware.beforeLoopBegin, this.toolTimeout)
      if (signal.aborted) return { messages, iterations, usage, durationMs: Date.now() - startTime, ...(stopReason && { stopReason }) }

      while (this.maxIterations === 0 || iterations < this.maxIterations) {
        if (this.maxTokenBudget > 0 && (usage.inputTokens + usage.outputTokens) >= this.maxTokenBudget) {
          this.logger.info('token budget exceeded', { used: usage.inputTokens + usage.outputTokens, budget: this.maxTokenBudget })
          stopReason = 'token_budget_exceeded'
          break
        }
        if (this.maxDuration > 0 && (Date.now() - startTime) >= this.maxDuration) {
          this.logger.info('max duration exceeded', { elapsedMs: Date.now() - startTime, maxDuration: this.maxDuration })
          stopReason = 'max_duration_exceeded'
          break
        }

        iterations++
        this.logger.debug('iteration starting', { iteration: iterations, messageCount: messages.length })

        const request = this.buildRequest(messages, iterations, signal)
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
          const exec = (tc: IToolCall) => this.executeSingleTool(tc, stoppable, loopCtx, usage)
          if (this.parallelToolCalls) {
            messages.push(...await Promise.all(toolCalls.map(exec)))
          } else {
            for (const tc of toolCalls) {
              if (signal.aborted) break
              messages.push(await exec(tc))
            }
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
        return { messages, iterations, usage, durationMs: Date.now() - startTime, stopReason: stopReason ?? 'aborted' }
      }
      // Attempt recovery via compaction when a provider rejects due to context length.
      if (this.compactionConfig && currentPhase === 'stream' && isContextLengthError(err) && _compactionRetries < MAX_COMPACTION_RETRIES) {
        this.logger.info('context length exceeded, attempting compaction recovery', { attempt: _compactionRetries + 1, maxRetries: MAX_COMPACTION_RETRIES })
        const modelCallCtx: ModelCallContext = {
          ...stoppable,
          request: this.buildRequest(messages, iterations, signal),
          loop: loopCtx(),
        }
        const compacted = await forceCompact(this.provider, this.compactionConfig, modelCallCtx)
        if (compacted) {
          this.logger.info('compaction recovery succeeded, restarting loop', { messageCount: messages.length, attempt: _compactionRetries + 1 })
          this.externalAbort = null
          return this.run(messages, _compactionRetries + 1, { iterations, usage, startTime })
        }
        this.logger.error('compaction recovery failed', { attempt: _compactionRetries + 1 })
      }
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain({ ...stoppable, error, loop: loopCtx(), phase: currentPhase } satisfies ErrorContext, this.middleware.onError, this.toolTimeout)
      throw err
    }

    this.externalAbort = null
    const finalReason = stopReason ?? (signal.aborted && !stoppedInternally ? 'aborted' : undefined)
    return { messages, iterations, usage, durationMs: Date.now() - startTime, ...(finalReason && { stopReason: finalReason }) }
  }
}
