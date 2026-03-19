import type { ITool } from '@chinmaymk/ra'

export function askUserTool(): ITool {
  return {
    name: 'AskUserQuestion',
    description:
      'Ask the user a question and wait for their reply. ' +
      'Use when you need clarification or confirmation before proceeding. Call only once per turn.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Clear, specific question for the user' },
      },
      required: ['question'],
    },
    async execute() {
      throw new Error('ask_user is not available in this context')
    },
  }
}
