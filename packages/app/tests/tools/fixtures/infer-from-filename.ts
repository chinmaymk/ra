export default {
  description: 'Tool with no explicit name — infer from filename',
  inputSchema: { type: 'object', properties: {} },
  async execute() {
    return 'inferred'
  },
}
