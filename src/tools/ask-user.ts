import type { ITool } from '../providers/types'

export const ASK_USER_SIGNAL = '__RA_ASK_USER__'

export function askUserTool(): ITool {
  return {
    name: 'ask_user',
    description:
      'Ask the user a question and wait for their response. ' +
      'Use this when you need clarification, confirmation, or additional information from the user before proceeding. ' +
      'The agent loop will pause after this tool is called. The user\'s response will come as a new message when they reply. ' +
      'Provide a clear, specific question.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to ask the user' },
      },
      required: ['question'],
    },
    async execute(input: unknown) {
      const { question } = input as { question: string }
      return `${ASK_USER_SIGNAL}${question}`
    },
  }
}
