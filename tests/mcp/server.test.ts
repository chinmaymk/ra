import { describe, it, expect, afterEach } from 'bun:test'
import { startMcpHttp } from '../../src/mcp/server'

const toolConfig = {
  name: 'ra',
  description: 'Run the RA agent with a prompt',
  inputSchema: {},
}

describe('startMcpHttp', () => {
  let stop: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (stop) { await stop(); stop = null }
  })

  it('starts and exposes /mcp endpoint with tools/list', async () => {
    stop = await startMcpHttp({ port: 3098, tool: toolConfig }, async (input) => `echo: ${JSON.stringify(input)}`)

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }

    const initRes = await fetch('http://localhost:3098/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
      })
    })
    expect(initRes.status).toBe(200)
    const sessionId = initRes.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()

    const toolsRes = await fetch('http://localhost:3098/mcp', {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    })
    expect(toolsRes.status).toBe(200)

    const contentType = toolsRes.headers.get('content-type') ?? ''
    let tools: any[]
    if (contentType.includes('text/event-stream')) {
      const text = await toolsRes.text()
      const dataLine = text.split('\n').find(l => l.startsWith('data: '))!
      tools = JSON.parse(dataLine.slice(6)).result?.tools
    } else {
      tools = (await toolsRes.json() as any).result?.tools
    }

    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('ra')
    expect(tools[0].inputSchema.properties).toHaveProperty('prompt')
  })

  it('returns 404 for unknown paths', async () => {
    stop = await startMcpHttp({ port: 3097, tool: toolConfig }, async () => 'ok')
    const res = await fetch('http://localhost:3097/unknown')
    expect(res.status).toBe(404)
  })
})
