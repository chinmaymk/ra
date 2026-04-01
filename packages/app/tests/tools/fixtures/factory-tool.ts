export default function createTool() {
  return {
    name: 'FactoryTool',
    description: 'A tool created by a factory function',
    inputSchema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'A count' },
      },
      required: ['count'],
    },
    async execute(input: unknown) {
      const { count } = input as { count: number }
      return `count: ${count}`
    },
  }
}
