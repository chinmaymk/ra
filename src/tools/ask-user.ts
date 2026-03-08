import type { ITool, IMessage } from '../providers/types'

export const ASK_USER_SIGNAL = '__RA_ASK_USER__'

/** Extract the ask_user question from the last tool message, if any. */
export function findAskUserQuestion(messages: IMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL)) {
      return m.content.slice(ASK_USER_SIGNAL.length)
    }
  }
  return undefined
}

export function askUserTool(): ITool {
  return {
    name: 'ask_user',
    description:
      'Ask the user a question. The agent loop pauses until the user replies. ' +
      'Use when you need clarification or confirmation before proceeding. Call only once per turn.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Clear, specific question for the user' },
      },
      required: ['question'],
    },
    async execute(input: unknown) {
      const { question } = input as { question: string }
      return `${ASK_USER_SIGNAL}${question}`
    },
  }
}
