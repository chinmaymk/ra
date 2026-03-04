import type { IProvider, IMessage, IToolCall } from '../providers/types'
import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext, StoppableContext } from './types'
import { runMiddlewareChain } from './middleware'
import type { ToolRegistry } from './tool-registry'
import { createCompactionMiddleware, type CompactionConfig } from './context-compaction'
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
}

export interface LoopResult {
  messages: IMessage[]
  iterations: number
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

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? 10
    this.model = options.model ?? 'default'
    this.sessionId = options.sessionId ?? randomUUID()
    this.middleware = { ...EMPTY_MW, ...options.middleware }
    this.thinking = options.thinking
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

    const stoppable: StoppableContext = { stop, signal }

    const loopCtx = (): LoopContext => ({ ...stoppable, messages, iteration: iterations, maxIterations: this.maxIterations, sessionId: this.sessionId })

    let currentPhase: 'model_call' | 'tool_execution' | 'stream' = 'model_call'

    try {
      await runMiddlewareChain(loopCtx(), this.middleware.beforeLoopBegin)
      if (signal.aborted) return { messages, iterations }

      while (iterations < this.maxIterations) {
        iterations++

        const request = {
          model: this.model,
          messages: [...messages],
          tools: this.tools.all(),
          ...(this.thinking && { thinking: this.thinking }),
        }
        const modelCallCtx: ModelCallContext = { ...stoppable, request, loop: loopCtx() }
        await runMiddlewareChain(modelCallCtx, this.middleware.beforeModelCall)
        if (signal.aborted) break

        let textAccumulator = ''
        const toolCallBuf: { id: string; name: string; argsRaw: string }[] = []

        currentPhase = 'stream'
        for await (const chunk of this.provider.stream(request)) {
          if (chunk.type === 'thinking') {
            await runMiddlewareChain({ ...stoppable, chunk, loop: loopCtx() } satisfies StreamChunkContext, this.middleware.onStreamChunk)
            if (signal.aborted) break
          } else if (chunk.type === 'text') {
            await runMiddlewareChain({ ...stoppable, chunk, loop: loopCtx() } satisfies StreamChunkContext, this.middleware.onStreamChunk)
            if (signal.aborted) break
            textAccumulator += chunk.delta
          } else if (chunk.type === 'tool_call_start') {
            toolCallBuf.push({ id: chunk.id, name: chunk.name, argsRaw: '' })
          } else if (chunk.type === 'tool_call_delta') {
            const tc = toolCallBuf.find(t => t.id === chunk.id)
            if (tc) tc.argsRaw += chunk.argsDelta
          } else if (chunk.type === 'done') {
            break
          }
        }

        if (signal.aborted) break

        const toolCalls: IToolCall[] = toolCallBuf.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.argsRaw }))
        messages.push({ role: 'assistant', content: textAccumulator, ...(toolCalls.length && { toolCalls }) })
        await runMiddlewareChain(modelCallCtx, this.middleware.afterModelResponse)
        if (signal.aborted) break

        if (toolCalls.length) {
          currentPhase = 'tool_execution'
          const results = await Promise.allSettled(
            toolCalls.map(async tc => {
              await runMiddlewareChain({ ...stoppable, toolCall: tc, loop: loopCtx() } satisfies ToolExecutionContext, this.middleware.beforeToolExecution)
              if (signal.aborted) return ''
              let input: unknown
              try { input = JSON.parse(tc.arguments || '{}') } catch { input = {} }
              try {
                const value = await this.tools.execute(tc.name, input)
                const content = typeof value === 'string' ? value : JSON.stringify(value)
                await runMiddlewareChain({ ...stoppable, toolCall: tc, result: { toolCallId: tc.id, content, isError: false }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution)
                return content
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err)
                await runMiddlewareChain({ ...stoppable, toolCall: tc, result: { toolCallId: tc.id, content: errMsg, isError: true }, loop: loopCtx() } satisfies ToolResultContext, this.middleware.afterToolExecution)
                throw err
              }
            })
          )
          currentPhase = 'model_call'

          if (!signal.aborted) {
            for (let i = 0; i < toolCalls.length; i++) {
              const tc = toolCalls[i]!
              const settled = results[i]!
              const isError = settled.status === 'rejected'
              const content = isError
                ? (settled.reason instanceof Error ? settled.reason.message : String(settled.reason))
                : settled.value
              messages.push({ role: 'tool', content, toolCallId: tc.id, ...(isError && { isError: true }) })
            }
          }
        }

        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopIteration)
        if (signal.aborted) break
        if (!toolCalls.length) break
      }

      if (!signal.aborted) {
        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopComplete)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain({ ...stoppable, error, loop: loopCtx(), phase: currentPhase } satisfies ErrorContext, this.middleware.onError)
      throw err
    }

    return { messages, iterations }
  }
}
