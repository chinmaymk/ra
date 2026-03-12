import type { IProvider, IMessage, IToolCall, TokenUsage } from '../providers/types'
import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext, StoppableContext } from './types'
import { runMiddlewareChain } from './middleware'
import type { ToolRegistry } from './tool-registry'
import { createCompactionMiddleware, type CompactionConfig } from './context-compaction'
import { accumulateUsage } from '../providers/utils'
import { withTimeout } from './timeout'
import { randomUUID } from 'crypto'

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
}

export interface LoopResult {
  messages: IMessage[]
  iterations: number
  usage: TokenUsage
  stopReason?: string
}

const EMPTY_MW: MiddlewareConfig = {
  beforeLoopBegin: [], beforeModelCall: [], onStreamChunk: [],
  beforeToolExecution: [], afterToolExecution: [], afterModelResponse: [],
  afterLoopIteration: [], afterLoopComplete: [], onError: [],
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
  private controller: AbortController | null = null

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? 10
    this.model = options.model ?? 'default'
    this.sessionId = options.sessionId ?? randomUUID()
    this.middleware = { ...EMPTY_MW, ...options.middleware }
    this.thinking = options.thinking
    this.toolTimeout = options.toolTimeout ?? 0
    if (options.compaction?.enabled) {
      this.middleware.beforeModelCall = [
        createCompactionMiddleware(this.provider, options.compaction),
        ...this.middleware.beforeModelCall,
      ]
    }
  }

  abort(): void {
    this.controller?.abort()
  }

  async run(initialMessages: IMessage[]): Promise<LoopResult> {
    const messages: IMessage[] = [...initialMessages]
    let iterations = 0
    const controller = new AbortController()
    this.controller = controller
    let stopReason: string | undefined
    const stop = (reason?: string) => {
      stopReason = reason
      if (reason) console.log(`[ra] loop stopped: ${reason}`)
      controller.abort()
    }
    const { signal } = controller

    const stoppable: StoppableContext = { stop, signal }

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
        }
        const modelCallCtx: ModelCallContext = { ...stoppable, request, loop: loopCtx() }
        await runMiddlewareChain(modelCallCtx, this.middleware.beforeModelCall, this.toolTimeout)
        if (signal.aborted) break

        let textAccumulator = ''
        const toolCallBuf: { id: string; name: string; argsRaw: string }[] = []

        currentPhase = 'stream'
        for await (const chunk of this.provider.stream(request)) {
          if (chunk.type === 'thinking') {
            await runMiddlewareChain({ ...stoppable, chunk, loop: loopCtx() } satisfies StreamChunkContext, this.middleware.onStreamChunk, this.toolTimeout)
            if (signal.aborted) break
          } else if (chunk.type === 'text') {
            await runMiddlewareChain({ ...stoppable, chunk, loop: loopCtx() } satisfies StreamChunkContext, this.middleware.onStreamChunk, this.toolTimeout)
            if (signal.aborted) break
            textAccumulator += chunk.delta
          } else if (chunk.type === 'tool_call_start') {
            toolCallBuf.push({ id: chunk.id, name: chunk.name, argsRaw: '' })
          } else if (chunk.type === 'tool_call_delta') {
            const tc = toolCallBuf.find(t => t.id === chunk.id)
            if (tc) tc.argsRaw += chunk.argsDelta
          } else if (chunk.type === 'done') {
            if (chunk.usage) {
              accumulateUsage(usage, chunk.usage)
              lastUsage = chunk.usage
            }
            break
          }
        }

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
            let input: unknown
            try { input = JSON.parse(tc.arguments || '{}') } catch { input = {} }
            let content: string
            let isError = false
            try {
              const value = this.toolTimeout > 0
                ? await withTimeout(this.tools.execute(tc.name, input), this.toolTimeout, `Tool '${tc.name}'`)
                : await this.tools.execute(tc.name, input)
              content = typeof value === 'string' ? value : JSON.stringify(value)
              // Roll up child usage (e.g. from subagent tool) into parent totals
              if (value && typeof value === 'object' && 'usage' in value) {
                const childUsage = (value as { usage: TokenUsage }).usage
                if (childUsage) accumulateUsage(usage, childUsage)
              }
              await runMiddlewareChain({ ...stoppable, toolCall: tc, result: { toolCallId: tc.id, content, isError: false }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution, this.toolTimeout)
            } catch (err) {
              isError = true
              content = err instanceof Error ? err.message : String(err)
              await runMiddlewareChain({ ...stoppable, toolCall: tc, result: { toolCallId: tc.id, content, isError: true }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution, this.toolTimeout)
            }
            messages.push({ role: 'tool', content, toolCallId: tc.id, ...(isError && { isError: true }) })
          }
          currentPhase = 'model_call'
        }

        // Break if ask_user was invoked — the loop should suspend
        if (toolCalls.some(tc => tc.name === 'ask_user')) { stop(); break }

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
        this.controller = null
        return { messages, iterations, usage, stopReason: stopReason ?? 'aborted' }
      }
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain({ ...stoppable, error, loop: loopCtx(), phase: currentPhase } satisfies ErrorContext, this.middleware.onError, this.toolTimeout)
      throw err
    }

    this.controller = null
    return { messages, iterations, usage, ...(stopReason && { stopReason }) }
  }
}
