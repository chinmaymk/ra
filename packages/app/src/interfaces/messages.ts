import type { IMessage } from '@chinmaymk/ra'
import type { Skill } from '../skills/types'
import { buildAvailableSkillsXml, buildActiveSkillXml } from '../skills/loader'

/**
 * Build the standard message prefix shared across all interfaces:
 *   system prompt → active skill bodies → available skills XML → context files
 *
 * Each interface appends its own messages after this prefix
 * (e.g. session history, user input).
 */
export function buildMessagePrefix(options: {
  systemPrompt?: string
  skillMap?: Map<string, Skill>
  contextMessages?: IMessage[]
  /** Skill names to inject as full active skill bodies (CLI --skill flag). */
  activeSkillNames?: string[]
}): IMessage[] {
  const messages: IMessage[] = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  // Active skills — injected with full body
  const activeSet = new Set<string>()
  if (options.activeSkillNames?.length && options.skillMap) {
    for (const name of options.activeSkillNames) {
      const skill = options.skillMap.get(name)
      if (skill) {
        messages.push({ role: 'user', content: buildActiveSkillXml(skill) })
        activeSet.add(name)
      }
    }
  }

  // Available skills — summary XML (excluding already-active skills)
  if (options.skillMap && options.skillMap.size > activeSet.size) {
    const xml = buildAvailableSkillsXml(options.skillMap, activeSet.size > 0 ? activeSet : undefined)
    if (xml) messages.push({ role: 'user', content: xml })
  }

  // Context files
  if (options.contextMessages?.length) {
    messages.push(...options.contextMessages)
  }

  return messages
}
