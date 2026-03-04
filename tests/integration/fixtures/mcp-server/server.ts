import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'test-server', version: '1.0.0' })

server.tool('echo_text', 'Echo the input text', { text: z.string() }, async ({ text }) => ({
  content: [{ type: 'text' as const, text: `echo: ${text}` }],
}))

server.tool('fail_tool', 'Always fails', {}, async () => {
  throw new Error('intentional failure')
})

server.connect(new StdioServerTransport())
