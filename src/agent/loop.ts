import type { IProvider, IMessage, IToolCall, TokenUsage } from '../providers/types'
import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext, StoppableContext } from './types'
import { runMiddlewareChain } from './middleware'
import type { ToolRegistry } from './tool-registry'
import { createCompactionMiddleware, type CompactionConfig } from './context-compaction'
import { withTimeout } from './timeout'
import { randomUUID } from 'crypto'

export interface AgentLoopOptions {
  provider: IProvider
  tools: ToolRegistry
  maxIterations?: number
  maxRetries?: number
  maxDuration?: number
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
}

const EMPTY_MW: MiddlewareConfig = {
  beforeLoopBegin: [], beforeModelCall: [], onStreamChunk: [],
  beforeToolExecution: [], afterToolExecution: [], afterModelResponse: [],
  afterLoopIteration: [], afterLoopComplete: [], onError: [],
}

function isRetryable(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const status = (err as { status?: number }).status
    if (status === 429 || status === 503 || status === 529) return true
    const code = (err as { code?: string }).code
    if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'UND_ERR_SOCKET') return true
  }
  return false
}

function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 60000)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class AgentLoop {
  private provider: IProvider
  private tools: ToolRegistry
  private maxIterations: number
  private maxRetries: number
  private maxDuration: number
  private model: string
  private middleware: MiddlewareConfig
  private sessionId: string
  private thinking: 'low' | 'medium' | 'high' | undefined
  private toolTimeout: number

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? 10
    this.maxRetries = options.maxRetries ?? 0
    this.maxDuration = options.maxDuration ?? 0
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

  async run(initialMessages: IMessage[]): Promise<LoopResult> {
    const messages: IMessage[] = [...initialMessages]
    let iterations = 0
    const controller = new AbortController()
    const stop = () => controller.abort()
    const { signal } = controller

    // Wall-clock limit: abort when maxDuration elapses
    if (this.maxDuration > 0) {
      const timer = setTimeout(() => controller.abort(), this.maxDuration)
      signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    }

    const stoppable: StoppableContext = { stop, signal }

    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
    let lastUsage: TokenUsage | undefined

    const loopCtx = (): LoopContext => ({ ...stoppable, messages, iteration: iterations, maxIterations: this.maxIterations, sessionId: this.sessionId, usage, lastUsage })

    let currentPhase: 'model_call' | 'tool_execution' | 'stream' = 'model_call'

    try {
      await runMiddlewareChain(loopCtx(), this.middleware.beforeLoopBegin, this.toolTimeout)
      if (signal.aborted) return { messages, iterations, usage }

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

        // Retry loop around provider.stream()
        let attempt = 0
        while (true) {
          try {
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
                  usage.inputTokens += chunk.usage.inputTokens
                  usage.outputTokens += chunk.usage.outputTokens
                  if (chunk.usage.thinkingTokens) {
                    usage.thinkingTokens = (usage.thinkingTokens ?? 0) + chunk.usage.thinkingTokens
                  }
                  lastUsage = chunk.usage
                }
                break
              }
            }
            break // stream completed successfully
          } catch (err) {
            if (attempt < this.maxRetries && isRetryable(err) && !signal.aborted) {
              attempt++
              textAccumulator = ''
              toolCallBuf.length = 0
              await sleep(retryDelay(attempt - 1))
              continue
            }
            throw err
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
            await runMiddlewareChain({ ...stoppable, toolCall: tc, loop: loopCtx() } satisfies ToolExecutionContext, this.middleware.beforeToolExecution, this.toolTimeout)
            if (signal.aborted) break
            let input: unknown
            try { input = JSON.parse(tc.arguments || '{}') } catch { input = {} }
            let content: string
            let isError = false
            try {
              const value = this.toolTimeout > 0
                ? await withTimeout(this.tools.execute(tc.name, input), this.toolTimeout, `Tool '${tc.name}'`)
                : await this.tools.execute(tc.name, input)
              content = typeof value === 'string' ? value : JSON.stringify(value)
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
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain({ ...stoppable, error, loop: loopCtx(), phase: currentPhase } satisfies ErrorContext, this.middleware.onError, this.toolTimeout)
      throw err
    }

    return { messages, iterations, usage }
  }
}
