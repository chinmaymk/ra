export default async function createTool() {
  return {
    name: 'AsyncFactoryTool',
    description: 'A tool created by an async factory function',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string', description: 'A value' },
      },
      required: ['value'],
    },
    async execute(input: unknown) {
      const { value } = input as { value: string }
      return `async: ${value}`
    },
  }
}
