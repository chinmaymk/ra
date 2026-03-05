import type { ITool } from '../providers/types'

export const ASK_USER_SIGNAL = '__RA_ASK_USER__'

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
