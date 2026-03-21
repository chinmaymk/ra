import type { IMessage } from '@chinmaymk/ra'
import type { SkillIndex } from '../skills/types'
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
  skillIndex?: Map<string, SkillIndex>
  contextMessages?: IMessage[]
}): IMessage[] {
  const messages: IMessage[] = []

  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }

  // Available skills — summary XML so the model knows what skills can be activated via /skill-name
  if (options.skillIndex && options.skillIndex.size > 0) {
    const xml = buildAvailableSkillsXml(options.skillIndex)
    if (xml) messages.push({ role: 'user', content: xml })
  }

  // Context files
  if (options.contextMessages?.length) {
    messages.push(...options.contextMessages)
  }

  return messages
}

/**
 * Build the full message thread for a loop invocation.
 *
 * New session (storedMessages is empty): builds the prefix and returns priorCount=0
 * so the history middleware saves everything.
 *
 * Existing session / resume: copies storedMessages (prefix is already there)
 * and returns priorCount = storedMessages.length so only new messages get saved.
 *
 * Callers append their user message(s) to the returned array.
 */
export function buildThreadMessages(options: {
  storedMessages: IMessage[]
  systemPrompt?: string
  skillIndex?: Map<string, SkillIndex>
  contextMessages?: IMessage[]
}): { messages: IMessage[]; priorCount: number } {
  if (options.storedMessages.length === 0) {
    return {
      messages: buildMessagePrefix({
        systemPrompt: options.systemPrompt,
        skillIndex: options.skillIndex,
        contextMessages: options.contextMessages,
      }),
      priorCount: 0,
    }
  }
  return {
    messages: [...options.storedMessages],
    priorCount: options.storedMessages.length,
  }
}
