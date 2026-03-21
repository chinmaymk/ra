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
} from '@chinmaymk/ra'
import type { SkillIndex } from '../skills/types'
import type { SessionStorage } from '../storage/sessions'
import { createSessionMiddleware } from '../agent/session'
import { buildMessagePrefix } from './messages'
import { fileToContentPart } from '../utils/files'

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
  onChunk?: (text: string) => void
  thinking?: 'low' | 'medium' | 'high'
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
  const { prompt, files = [], systemPrompt, model, provider, tools, skillIndex, middleware, maxIterations, maxRetries, toolTimeout, maxToolResponseSize, onChunk = (t) => process.stdout.write(t), thinking, compaction, contextMessages = [], sessionMessages = [], logger, logsEnabled, logLevel, tracesEnabled, storage, sessionId } = options

  // When resuming a session the prefix (system prompt, skills, context) is
  // already part of the stored messages — don't re-inject it.
  // For new sessions, build the prefix and let the history middleware store it.
  const isResume = sessionMessages.length > 0
  const initialMessages: IMessage[] = isResume
    ? [...sessionMessages]
    : buildMessagePrefix({ systemPrompt, skillIndex, contextMessages })

  const priorCount = isResume ? sessionMessages.length : 0

  const parts: ContentPart[] = [{ type: 'text', text: prompt }, ...await Promise.all(files.map(fileToContentPart))]
  const content: string | ContentPart[] = parts.length === 1 ? prompt : parts
  initialMessages.push({ role: 'user', content })

  const session = storage && sessionId
    ? createSessionMiddleware(middleware, { storage, sessionId, priorCount, logsEnabled, logLevel, tracesEnabled, logger })
    : { middleware: middleware ?? {}, logger }
  const streamHook: Partial<MiddlewareConfig> = {
    onStreamChunk: [async (ctx: StreamChunkContext) => { if (ctx.chunk.type === 'text') onChunk(ctx.chunk.delta) }],
  }
  const loop = new AgentLoop({
    provider, tools, model, maxIterations, maxRetries, toolTimeout, maxToolResponseSize, thinking, compaction, sessionId,
    logger: session.logger,
    middleware: mergeMiddleware(streamHook, session.middleware),
  })

  const result = await loop.run(initialMessages)

  return { messages: result.messages, priorCount }
}
