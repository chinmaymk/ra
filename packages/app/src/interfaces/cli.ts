import {
  AgentLoop,
  mergeMiddleware,
  type IProvider,
  type IMessage,
  type ContentPart,
  type ToolRegistry,
  type MiddlewareConfig,
  type StreamChunkContext,
  type CompactionConfig,
  type Logger,
  type LogLevel,
  type ThinkingMode,
} from '@chinmaymk/ra'
import type { SkillIndex } from '../skills/types'
import type { SessionStorage } from '../storage/sessions'
import { createSessionMiddleware } from '../agent/session'
import { buildThreadMessages } from './messages'
import { fileToContentPart } from '../utils/files'
import * as tui from './tui'

export interface CliOptions {
  prompt: string
  files?: string[]
  systemPrompt?: string
  model: string
  provider: IProvider
  tools: ToolRegistry
  skillIndex?: Map<string, SkillIndex>
  middleware?: Partial<MiddlewareConfig>
  maxIterations?: number
  maxRetries?: number
  toolTimeout?: number
  maxToolResponseSize?: number
  parallelToolCalls?: boolean
  tokenBudget?: number
  maxDuration?: number
  onChunk?: (text: string) => void
  thinking?: ThinkingMode
  thinkingBudgetCap?: number
  compaction?: CompactionConfig
  contextMessages?: IMessage[]
  sessionMessages?: IMessage[]
  logger?: Logger
  logsEnabled?: boolean
  logLevel?: LogLevel
  tracesEnabled?: boolean
  storage?: SessionStorage
  sessionId?: string
}

export interface CliResult {
  messages: IMessage[]
  priorCount: number
}

export async function runCli(options: CliOptions): Promise<CliResult> {
  const { prompt, files = [], systemPrompt, model, provider, tools, skillIndex, middleware, maxIterations, maxRetries, toolTimeout, maxToolResponseSize, parallelToolCalls, tokenBudget, maxDuration, onChunk = (t) => process.stdout.write(t), thinking, compaction, contextMessages = [], sessionMessages = [], logger, logsEnabled, logLevel, tracesEnabled, storage, sessionId } = options

  const { messages: initialMessages, priorCount } = buildThreadMessages({
    storedMessages: sessionMessages,
    systemPrompt, skillIndex, contextMessages,
  })

  const parts: ContentPart[] = [{ type: 'text', text: prompt }, ...await Promise.all(files.map(fileToContentPart))]
  const content: string | ContentPart[] = parts.length === 1 ? prompt : parts
  initialMessages.push({ role: 'user', content })

  const session = storage && sessionId
    ? createSessionMiddleware(middleware, { storage, sessionId, priorCount, logsEnabled, logLevel, tracesEnabled, logger })
    : { middleware: middleware ?? {}, logger }
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
  const loop = new AgentLoop({
    provider, tools, model, maxIterations, maxRetries, toolTimeout, maxToolResponseSize, parallelToolCalls, tokenBudget, maxDuration, thinking, compaction, sessionId,
    logger: session.logger,
    middleware: mergeMiddleware(streamHook, session.middleware),
    resumed: sessionMessages.length > 0,
  })

  const result = await loop.run(initialMessages)
  if (thinkingState.thinkingOpened) tui.collapseThinking(thinkingState)

  return { messages: result.messages, priorCount }
}
