export const tool = {
  name: 'NoDefault',
  description: 'Missing default export',
  inputSchema: { type: 'object', properties: {} },
  async execute() { return 'nope' },
}
