import type { IProvider, IMessage, IToolCall } from '../providers/types'
import type { MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext } from './types'
import { runMiddlewareChain } from './middleware'
import type { ToolRegistry } from './tool-registry'
import { randomUUID } from 'crypto'

export interface AgentLoopOptions {
  provider: IProvider
  tools: ToolRegistry
  maxIterations?: number
  model?: string
  middleware?: Partial<MiddlewareConfig>
  sessionId?: string
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

  constructor(options: AgentLoopOptions) {
    this.provider = options.provider
    this.tools = options.tools
    this.maxIterations = options.maxIterations ?? 10
    this.model = options.model ?? 'default'
    this.sessionId = options.sessionId ?? randomUUID()
    this.middleware = { ...EMPTY_MW, ...options.middleware }
  }

  async run(initialMessages: IMessage[]): Promise<LoopResult> {
    const messages: IMessage[] = [...initialMessages]
    let iterations = 0

    const loopCtx = (): LoopContext => ({ messages, iteration: iterations, maxIterations: this.maxIterations, sessionId: this.sessionId })

    try {
      await runMiddlewareChain(loopCtx(), this.middleware.beforeLoopBegin)

      while (iterations < this.maxIterations) {
        iterations++

        const request = { model: this.model, messages: [...messages], tools: this.tools.all() }
        const modelCallCtx: ModelCallContext = { request, loop: loopCtx() }
        await runMiddlewareChain(modelCallCtx, this.middleware.beforeModelCall)

        let textAccumulator = ''
        const toolCallBuf: { id: string; name: string; argsRaw: string }[] = []

        for await (const chunk of this.provider.stream(request)) {
          if (chunk.type === 'text') {
            await runMiddlewareChain({ chunk, loop: loopCtx() }, this.middleware.onStreamChunk)
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

        const toolCalls: IToolCall[] = toolCallBuf.map(tc => ({ id: tc.id, name: tc.name, arguments: tc.argsRaw }))
        messages.push({ role: 'assistant', content: textAccumulator, ...(toolCalls.length && { toolCalls }) })
        await runMiddlewareChain(modelCallCtx, this.middleware.afterModelResponse)

        if (toolCalls.length) {
          const results = await Promise.allSettled(
          toolCalls.map(async tc => {
            await runMiddlewareChain({ toolCall: tc, loop: loopCtx() }, this.middleware.beforeToolExecution)
            let input: unknown
            try { input = JSON.parse(tc.arguments || '{}') } catch { input = {} }
            const value = await this.tools.execute(tc.name, input)
            const content = typeof value === 'string' ? value : JSON.stringify(value)
            await runMiddlewareChain({ toolCall: tc, result: { toolCallId: tc.id, content, isError: false }, loop: loopCtx() }, this.middleware.afterToolExecution)
            return content
          })
        )

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

        await runMiddlewareChain(loopCtx(), this.middleware.afterLoopIteration)
        if (!toolCalls.length) break
      }

      await runMiddlewareChain(loopCtx(), this.middleware.afterLoopComplete)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      await runMiddlewareChain({ error, loop: loopCtx(), phase: 'model_call' }, this.middleware.onError)
      throw err
    }

    return { messages, iterations }
  }
}
