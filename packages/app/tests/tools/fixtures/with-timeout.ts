export default {
  name: 'TimeoutTool',
  description: 'A tool with a custom timeout',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  timeout: 5000,
  async execute() {
    return 'done'
  },
}
