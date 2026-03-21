import type { IMessage } from '@chinmaymk/ra'
import type { Skill } from '../skills/types'
import { buildAvailableSkillsXml } from '../skills/loader'

/**
 * Build the standard message prefix shared across all interfaces:
 *   system prompt → available skills XML → context files
 *
 * Skills are activated via the /skill-name pattern resolver in prompts,
 * not through config. The available skills XML lists all loaded skills
 * so the model knows what's available.
 *
 * Each interface appends its own messages after this prefix
 * (e.g. session history, user input).
 */
export function buildMessagePrefix(options: {
  systemPrompt?: string
  skillMap?: Map<string, Skill>
  contextMessages?: IMessage[]
}): IMessage[] {
  const messages: IMessage[] = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  // Available skills — summary XML so the model knows what skills can be activated via /skill-name
  if (options.skillMap && options.skillMap.size > 0) {
    const xml = buildAvailableSkillsXml(options.skillMap)
    if (xml) messages.push({ role: 'user', content: xml })
  }

  // Context files
  if (options.contextMessages?.length) {
    messages.push(...options.contextMessages)
  }

  return messages
}
