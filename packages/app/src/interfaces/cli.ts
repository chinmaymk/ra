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
import type { Skill } from '../skills/types'
import type { SessionStorage } from '../storage/sessions'
import { createSessionMiddleware } from '../agent/session'
import { buildAvailableSkillsXml, buildActiveSkillXml } from '../skills/loader'
import { fileToContentPart } from '../utils/files'

export interface CliOptions {
  prompt: string
  files?: string[]
  skills?: string[]
  systemPrompt?: string
  model: string
  provider: IProvider
  tools: ToolRegistry
  skillMap?: Map<string, Skill>
  middleware?: Partial<MiddlewareConfig>
  maxIterations?: number
  maxRetries?: number
  toolTimeout?: number
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
  const { prompt, files = [], skills = [], systemPrompt, model, provider, tools, skillMap, middleware, maxIterations, maxRetries, toolTimeout, onChunk = (t) => process.stdout.write(t), thinking, compaction, contextMessages = [], sessionMessages = [], logger, logsEnabled, logLevel, tracesEnabled, storage, sessionId } = options

  const initialMessages: IMessage[] = []
  if (systemPrompt) initialMessages.push({ role: 'system', content: systemPrompt })
  // Inject always-on skills as user messages with full body
  const activeSkillNames = new Set<string>()
  if (skills.length && skillMap) {
    for (const name of skills) {
      const skill = skillMap.get(name)
      if (skill) {
        initialMessages.push({ role: 'user', content: buildActiveSkillXml(skill) })
        activeSkillNames.add(name)
      }
    }
  }

  // Inject discovered (non-active) skills as available_skills XML
  if (skillMap && skillMap.size > activeSkillNames.size) {
    const xml = buildAvailableSkillsXml(skillMap, activeSkillNames)
    if (xml) initialMessages.push({ role: 'user', content: xml })
  }
  // Inject context-file messages before user prompt
  if (contextMessages.length) {
    initialMessages.push(...contextMessages)
  }
  initialMessages.push(...sessionMessages)

  const priorCount = initialMessages.length

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
    provider, tools, model, maxIterations, maxRetries, toolTimeout, thinking, compaction, sessionId,
    logger: session.logger,
    middleware: mergeMiddleware(streamHook, session.middleware),
  })

  const result = await loop.run(initialMessages)

  return { messages: result.messages, priorCount }
}
