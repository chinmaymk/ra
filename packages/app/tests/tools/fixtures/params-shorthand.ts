export default {
  description: 'A tool using parameters shorthand',
  parameters: {
    path: { type: 'string' as const, description: 'File path' },
    recursive: { type: 'boolean' as const, description: 'Recurse into subdirs', optional: true },
  },
  async execute(input: unknown) {
    const { path } = input as { path: string }
    return `reading: ${path}`
  },
}
