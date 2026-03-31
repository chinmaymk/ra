export default {
  name: 'ObjectTool',
  description: 'A tool exported as a plain object',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'A message' },
    },
    required: ['message'],
  },
  async execute(input: unknown) {
    const { message } = input as { message: string }
    return `echo: ${message}`
  },
}
