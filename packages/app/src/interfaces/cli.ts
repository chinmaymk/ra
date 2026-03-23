import {
  AgentLoop,
  mergeMiddleware,
  type IMessage,
  type ContentPart,
  type MiddlewareConfig,
  type StreamChunkContext,
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

  const thinkingState = tui.createStreamState()
  const streamHook: Partial<MiddlewareConfig> = {
    onStreamChunk: [async (ctx: StreamChunkContext) => {
      if (ctx.chunk.type === 'thinking') {
        tui.handleStreamChunk(thinkingState, ctx.chunk.type, ctx.chunk.delta)
      } else if (ctx.chunk.type === 'text') {
        if (thinkingState.thinkingOpened) tui.collapseThinking(thinkingState)
        onChunk(ctx.chunk.delta)
      }
    }],
  }

  let loop: AgentLoop
  if (options.storage && options.sessionId) {
    const result = createSessionLoop(options, {
      storage: options.storage,
      sessionId: options.sessionId,
      priorCount,
      resumed: sessionMessages.length > 0,
      extraMiddleware: streamHook,
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
      middleware: mergeMiddleware(streamHook, session.middleware),
      resumed: sessionMessages.length > 0,
    })
  }

  const result = await loop.run(initialMessages)
  if (thinkingState.thinkingOpened) tui.collapseThinking(thinkingState)

  return { messages: result.messages, priorCount }
}
