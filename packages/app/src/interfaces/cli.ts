import {
  AgentLoop,
  mergeMiddleware,
  type IMessage,
  type ContentPart,
  type MiddlewareConfig,
  type StreamChunkContext,
  type ToolExecutionContext,
  type ToolResultContext,
} from '@chinmaymk/ra'
import { buildThreadMessages, createSessionLoop, type BaseLoopOptions } from './messages'
import { fileToContentPart } from '../utils/files'
import * as tui from './tui'

export interface CliOptions extends BaseLoopOptions {
  prompt: string
  files?: string[]
  onChunk?: (text: string) => void
  sessionMessages?: IMessage[]
}

export interface CliResult {
  messages: IMessage[]
  priorCount: number
}

export async function runCli(options: CliOptions): Promise<CliResult> {
  const { prompt, files = [], onChunk = (t) => process.stdout.write(t), sessionMessages = [] } = options

  const { messages: initialMessages, priorCount } = buildThreadMessages({
    storedMessages: sessionMessages,
    systemPrompt: options.systemPrompt,
    skillIndex: options.skillIndex,
    contextMessages: options.contextMessages,
  })

  const parts: ContentPart[] = [{ type: 'text', text: prompt }, ...await Promise.all(files.map(fileToContentPart))]
  const content: string | ContentPart[] = parts.length === 1 ? prompt : parts
  initialMessages.push({ role: 'user', content })

  const tuiState = tui.createStreamState()
  const tuiHooks: Partial<MiddlewareConfig> = {
    onStreamChunk: [async (ctx: StreamChunkContext) => {
      const chunk = ctx.chunk
      const delta = 'delta' in chunk ? chunk.delta : undefined
      const toolName = chunk.type === 'tool_call_start' ? chunk.name : undefined
      if (chunk.type === 'text' && delta) {
        if (tuiState.thinkingOpened) tui.collapseThinking(tuiState)
        if (!tuiState.boxOpened) { tuiState.boxOpened = true }
        onChunk(delta)
      } else {
        tui.handleStreamChunk(tuiState, chunk.type, delta, toolName)
      }
    }],
    beforeToolExecution: [
      async (ctx: ToolExecutionContext) => {
        tui.clearPendingTools(tuiState)
        if (tuiState.thinkingOpened) tui.collapseThinking(tuiState)
        tuiState.toolStartTimes.set(ctx.toolCall.id, Date.now())
        tui.printToolCall(tuiState, ctx.toolCall.id, ctx.toolCall.name, ctx.toolCall.arguments)
      },
    ],
    afterToolExecution: [
      async (ctx: ToolResultContext) => {
        const resultStr = typeof ctx.result.content === 'string' ? ctx.result.content : ''
        tui.printToolResult(tuiState, ctx.toolCall.id, ctx.toolCall.name, Date.now() - (tuiState.toolStartTimes.get(ctx.toolCall.id) ?? Date.now()), resultStr, ctx.result.isError)
      },
    ],
  }

  let loop: AgentLoop
  if (options.storage && options.sessionId) {
    const result = createSessionLoop(options, {
      storage: options.storage,
      sessionId: options.sessionId,
      priorCount,
      resumed: sessionMessages.length > 0,
      extraMiddleware: tuiHooks,
    })
    loop = result.loop
  } else {
    // No session — run with raw middleware
    const session = { middleware: options.middleware ?? {}, logger: options.logger }
    loop = new AgentLoop({
      provider: options.provider,
      tools: options.tools,
      model: options.model,
      maxIterations: options.maxIterations,
      maxRetries: options.maxRetries,
      toolTimeout: options.toolTimeout,
      maxToolResponseSize: options.maxToolResponseSize,
      thinking: options.thinking,
      thinkingBudgetCap: options.thinkingBudgetCap,
      compaction: options.compaction,
      sessionId: options.sessionId,
      logger: session.logger,
      middleware: mergeMiddleware(tuiHooks, session.middleware),
      resumed: sessionMessages.length > 0,
    })
  }

  const result = await loop.run(initialMessages)
  if (tuiState.thinkingOpened) tui.collapseThinking(tuiState)

  return { messages: result.messages, priorCount }
}
