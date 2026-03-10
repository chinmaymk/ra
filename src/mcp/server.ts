import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { McpServerConfig } from '../config/types'
import type { ToolRegistry } from '../agent/tool-registry'

export type McpToolHandler = (input: unknown) => Promise<string>

function buildServer(config: McpServerConfig, handler: McpToolHandler, builtinTools?: ToolRegistry): McpServer {
  const server = new McpServer({ name: config.tool.name, version: '1.0.0' })
  server.tool(
    config.tool.name,
    config.tool.description,
    { prompt: z.string().describe('The prompt to send to the agent') },
    async ({ prompt }) => ({
      content: [{ type: 'text' as const, text: await handler(prompt) }],
    })
  )

  // Expose built-in tools as MCP tools (except ask_user)
  if (builtinTools) {
    for (const tool of builtinTools.all()) {
      if (tool.name === 'ask_user') continue
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema as any,
        async (args: Record<string, unknown>) => ({
          content: [{ type: 'text' as const, text: String(await tool.execute(args)) }],
        })
      )
    }
  }

  return server
}

export async function startMcpStdio(config: McpServerConfig, handler: McpToolHandler, builtinTools?: ToolRegistry): Promise<void> {
  const server = buildServer(config, handler, builtinTools)
  await server.connect(new StdioServerTransport())
}

export async function startMcpHttp(config: McpServerConfig, handler: McpToolHandler, builtinTools?: ToolRegistry): Promise<() => Promise<void>> {
  const server = buildServer(config, handler, builtinTools)
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
      if (!t) { res.writeHead(404).end('Session not found'); return }
      await t.close()
      transports.delete(sessionId)
      res.writeHead(200).end()
      return
    }

    let transport: StreamableHTTPServerTransport

    let isNew = false
    if (req.method === 'POST' && !sessionId) {
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() })
      transport.onclose = () => { if (transport.sessionId) transports.delete(transport.sessionId) }
      await server.connect(transport)
      isNew = true
    } else if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!
    } else {
      res.writeHead(400).end('Bad request: missing or invalid session')
      return
    }

    // Register transport before handling request to avoid race conditions
    // where concurrent requests can't find the session
    if (isNew && transport.sessionId) transports.set(transport.sessionId, transport)

    try {
      await transport.handleRequest(req, res)
      // Session ID may be assigned during handleRequest for new transports
      if (isNew && transport.sessionId && !transports.has(transport.sessionId)) {
        transports.set(transport.sessionId, transport)
      }
    } catch (err) {
      if (isNew) {
        if (transport.sessionId) transports.delete(transport.sessionId)
        await transport.close().catch(() => {})
      }
      if (!res.headersSent) {
        res.writeHead(500).end(`Internal server error: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
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
