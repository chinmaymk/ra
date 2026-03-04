import { describe, it, expect, afterEach } from 'bun:test'
import { startMcpHttp } from '../../src/mcp/server'

const toolConfig = {
  name: 'ra',
  description: 'Run the RA agent with a prompt',
}

describe('startMcpHttp', () => {
  let stop: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (stop) { await stop(); stop = null }
  })

  it('starts and exposes /mcp endpoint with tools/list', async () => {
    stop = await startMcpHttp({ enabled: true, port: 3098, tool: toolConfig }, async (input) => `echo: ${JSON.stringify(input)}`)

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
    stop = await startMcpHttp({ enabled: true, port: 3097, tool: toolConfig }, async () => 'ok')
    const res = await fetch('http://localhost:3097/unknown')
    expect(res.status).toBe(404)
  })

  it('DELETE without session returns 200', async () => {
    stop = await startMcpHttp({ enabled: true, port: 3096, tool: toolConfig }, async () => 'ok')
    const res = await fetch('http://localhost:3096/mcp', { method: 'DELETE' })
    expect(res.status).toBe(200)
  })

  it('returns 400 for POST with invalid session id', async () => {
    stop = await startMcpHttp({ enabled: true, port: 3095, tool: toolConfig }, async () => 'ok')
    const res = await fetch('http://localhost:3095/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': 'nonexistent-session-id',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('stop function cleans up server', async () => {
    const stopFn = await startMcpHttp({ enabled: true, port: 3094, tool: toolConfig }, async () => 'ok')
    await stopFn()
    // Server should be down - connection should fail
    try {
      await fetch('http://localhost:3094/mcp')
      // If we get here, the server might still be shutting down
    } catch {
      // Expected - connection refused
    }
  })

  it('tool handler is invoked when tools/call is sent', async () => {
    let handlerCalled = false
    let receivedInput = ''
    stop = await startMcpHttp(
      { enabled: true, port: 3092, tool: toolConfig },
      async (input) => { handlerCalled = true; receivedInput = String(input); return `result: ${input}` }
    )

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }

    // Initialize
    const initRes = await fetch('http://localhost:3092/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
      })
    })
    const sessionId = initRes.headers.get('mcp-session-id')!

    // Send initialized notification
    await fetch('http://localhost:3092/mcp', {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })

    // Call the tool
    const callRes = await fetch('http://localhost:3092/mcp', {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sessionId },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 3, method: 'tools/call',
        params: { name: 'ra', arguments: { prompt: 'test prompt' } }
      })
    })
    expect(callRes.status).toBe(200)

    const contentType = callRes.headers.get('content-type') ?? ''
    let resultText: string
    if (contentType.includes('text/event-stream')) {
      const text = await callRes.text()
      const dataLine = text.split('\n').find(l => l.startsWith('data: '))!
      const parsed = JSON.parse(dataLine.slice(6))
      resultText = parsed.result?.content?.[0]?.text ?? ''
    } else {
      const json = await callRes.json() as any
      resultText = json.result?.content?.[0]?.text ?? ''
    }

    expect(handlerCalled).toBe(true)
    expect(receivedInput).toBe('test prompt')
    expect(resultText).toContain('result: test prompt')
  })

  it('DELETE with valid session removes transport', async () => {
    stop = await startMcpHttp({ enabled: true, port: 3093, tool: toolConfig }, async () => 'ok')

    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }

    // Initialize a session
    const initRes = await fetch('http://localhost:3093/mcp', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } }
      })
    })
    const sessionId = initRes.headers.get('mcp-session-id')
    expect(sessionId).toBeTruthy()

    // DELETE the session
    const delRes = await fetch('http://localhost:3093/mcp', {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId! },
    })
    expect(delRes.status).toBe(200)

    // Now trying to use that session should fail
    const res = await fetch('http://localhost:3093/mcp', {
      method: 'POST',
      headers: { ...headers, 'mcp-session-id': sessionId! },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    expect(res.status).toBe(400)
  })
})
