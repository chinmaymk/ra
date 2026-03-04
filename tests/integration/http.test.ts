import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { spawnBinary, type InteractiveProcess } from './helpers/binary'

async function waitForPort(port: number, path = '/sessions', timeout = 8000): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`)
      if (res.status < 500) return
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Port ${port} not ready after ${timeout}ms`)
}

describe('HTTP interface integration', () => {
  let env: TestEnv
  let httpProc: InteractiveProcess
  const HTTP_PORT = 19876
  const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`

  beforeAll(async () => {
    env = await createTestEnv()
    httpProc = spawnBinary(
      ['--http', '--http-port', String(HTTP_PORT), '--model', 'claude-sonnet-4-6'],
      env.binaryEnv,
    )
    await waitForPort(HTTP_PORT)
  })

  afterAll(async () => {
    httpProc.kill()
    await env.cleanup()
  })

  afterEach(() => env.mock.resetRequests())

  it('POST /chat/sync returns { response } JSON with text', async () => {
    env.mock.enqueue([{ type: 'text', content: 'Hello from sync!' }])
    const res = await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(data.response).toContain('Hello from sync!')
  })

  it('POST /chat streams SSE events', async () => {
    env.mock.enqueue([{ type: 'text', content: 'streaming response' }])
    const res = await fetch(`${BASE_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'stream test' }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('data:')
  })

  it('GET /sessions returns sessions array', async () => {
    const res = await fetch(`${BASE_URL}/sessions`)
    expect(res.status).toBe(200)
    const data = await res.json() as any
    expect(Array.isArray(data.sessions)).toBe(true)
  })

  it('missing auth token returns 401', async () => {
    const tokenPort = HTTP_PORT + 1
    const tokenProc = spawnBinary(
      ['--http', '--http-port', String(tokenPort), '--http-token', 'secret123', '--model', 'claude-sonnet-4-6'],
      env.binaryEnv,
    )
    try {
      await waitForPort(tokenPort)
      const res = await fetch(`http://127.0.0.1:${tokenPort}/chat/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] }),
      })
      expect(res.status).toBe(401)
    } finally {
      tokenProc.kill()
    }
  })

  it('wrong auth token returns 401', async () => {
    const tokenPort = HTTP_PORT + 2
    const tokenProc = spawnBinary(
      ['--http', '--http-port', String(tokenPort), '--http-token', 'correct-token', '--model', 'claude-sonnet-4-6'],
      env.binaryEnv,
    )
    try {
      await waitForPort(tokenPort)
      const res = await fetch(`http://127.0.0.1:${tokenPort}/chat/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wrong-token' },
        body: JSON.stringify({ messages: [] }),
      })
      expect(res.status).toBe(401)
    } finally {
      tokenProc.kill()
    }
  })

  it('two sync requests with same sessionId share conversation', async () => {
    const sessionId = 'test-session-shared'
    env.mock.enqueue([{ type: 'text', content: 'First response.' }])
    await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'first turn' }], sessionId }),
    })
    env.mock.enqueue([{ type: 'text', content: 'Second response.' }])
    await fetch(`${BASE_URL}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'second turn' }], sessionId }),
    })
    expect(env.mock.requests()).toHaveLength(2)
  })
})
