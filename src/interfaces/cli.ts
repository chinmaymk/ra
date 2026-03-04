import type { IProvider, IMessage, ContentPart } from '../providers/types'
import type { ToolRegistry } from '../agent/tool-registry'
import type { MiddlewareConfig, StreamChunkContext } from '../agent/types'
import type { CompactionConfig } from '../agent/context-compaction'
import type { Skill } from '../skills/types'
import { AgentLoop } from '../agent/loop'
import { buildSkillMessages } from '../skills/runner'
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
  toolTimeout?: number
  onChunk?: (text: string) => void
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  sessionMessages?: IMessage[]
}

export interface CliResult {
  messages: IMessage[]
  priorCount: number
}

export async function runCli(options: CliOptions): Promise<CliResult> {
  const { prompt, files = [], skills = [], systemPrompt, model, provider, tools, skillMap, middleware, maxIterations, toolTimeout, onChunk = (t) => process.stdout.write(t), thinking, compaction, sessionMessages = [] } = options

  const initialMessages: IMessage[] = []
  if (systemPrompt) initialMessages.push({ role: 'system', content: systemPrompt })
  if (skills.length && skillMap) {
    for (const name of skills) {
      const skill = skillMap.get(name)
      if (skill) initialMessages.push(...await buildSkillMessages(skill, {}))
    }
  }
  initialMessages.push(...sessionMessages)

  const priorCount = initialMessages.length

  const parts: ContentPart[] = [{ type: 'text', text: prompt }, ...await Promise.all(files.map(fileToContentPart))]
  const content: string | ContentPart[] = parts.length === 1 ? prompt : parts
  initialMessages.push({ role: 'user', content })

  const loop = new AgentLoop({
    provider, tools, model, maxIterations, toolTimeout, thinking, compaction,
    middleware: {
      ...middleware,
      onStreamChunk: [
        async (ctx: StreamChunkContext) => { if (ctx.chunk.type === 'text') onChunk(ctx.chunk.delta) },
        ...(middleware?.onStreamChunk ?? []),
      ],
    },
  })

  const result = await loop.run(initialMessages)
  return { messages: result.messages, priorCount }
}
