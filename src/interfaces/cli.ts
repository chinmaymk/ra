import type { IMessage, ContentPart } from '../providers/types'
import type { StreamChunkContext } from '../agent/types'
import type { BaseOptions } from '../bootstrap'
import { AgentLoop } from '../agent/loop'
import { buildAvailableSkillsXml, buildActiveSkillXml } from '../skills/loader'
import { fileToContentPart } from '../utils/files'

export interface CliOptions extends BaseOptions {
  prompt: string
  files?: string[]
  skills?: string[]
  onChunk?: (text: string) => void
  sessionMessages?: IMessage[]
}

export interface CliResult {
  messages: IMessage[]
  priorCount: number
}

export async function runCli(options: CliOptions): Promise<CliResult> {
  const { prompt, files = [], skills = [], systemPrompt, model, provider, tools, skillMap, middleware, maxIterations, toolTimeout, onChunk = (t) => process.stdout.write(t), thinking, compaction, contextMessages = [], sessionMessages = [] } = options

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

  const loop = new AgentLoop({
    provider, tools, model, maxIterations, toolTimeout, thinking, compaction,
    middleware: {
      ...middleware,
      onStreamChunk: [
        async (ctx: StreamChunkContext) => { if (ctx.chunk.type === 'text') onChunk(ctx.chunk.delta) },
      ].concat(middleware?.onStreamChunk ?? []),
    },
  })

  const result = await loop.run(initialMessages)

  return { messages: result.messages, priorCount }
}
