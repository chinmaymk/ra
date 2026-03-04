import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

export interface McpServerConfig {
  port: number
  tool: { name: string; description: string; inputSchema: Record<string, unknown> }
}

export type McpToolHandler = (input: unknown) => Promise<string>

function buildServer(config: McpServerConfig, handler: McpToolHandler): McpServer {
  const server = new McpServer({ name: config.tool.name, version: '1.0.0' })
  server.tool(
    config.tool.name,
    config.tool.description,
    { prompt: z.string().describe('The prompt to send to the agent') },
    async ({ prompt }) => ({
      content: [{ type: 'text' as const, text: await handler(prompt) }],
    })
  )
  return server
}

export async function startMcpStdio(config: McpServerConfig, handler: McpToolHandler): Promise<void> {
  const server = buildServer(config, handler)
  await server.connect(new StdioServerTransport())
}

export async function startMcpHttp(config: McpServerConfig, handler: McpToolHandler): Promise<() => Promise<void>> {
  const server = buildServer(config, handler)
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${config.port}`)
    if (url.pathname !== '/mcp') {
      res.writeHead(404).end('Not found')
      return
    }

    const sessionId = (req.headers['mcp-session-id'] as string | undefined) ?? ''

    if (req.method === 'DELETE') {
      const t = transports.get(sessionId)
      if (t) { await t.close(); transports.delete(sessionId) }
      res.writeHead(200).end()
      return
    }

    let transport: StreamableHTTPServerTransport

    if (req.method === 'POST' && !sessionId) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId) }
      await server.connect(transport)
    } else if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!
    } else {
      res.writeHead(400).end('Bad request: missing or invalid session')
      return
    }

    await transport.handleRequest(req, res)
    if (transport.sessionId && !transports.has(transport.sessionId)) {
      transports.set(transport.sessionId, transport)
    }
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, () => resolve())
    httpServer.once('error', reject)
  })

  return async () => {
    for (const t of transports.values()) await t.close()
    transports.clear()
    await server.close()
    await new Promise<void>((resolve, reject) => httpServer.close(err => err ? reject(err) : resolve()))
  }
}
