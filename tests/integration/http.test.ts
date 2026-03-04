import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { spawnHttpServer, type InteractiveProcess } from './helpers/binary'

describe('HTTP interface integration', () => {
  let env: TestEnv
  let httpProc: InteractiveProcess
  let BASE_URL: string

  beforeAll(async () => {
    env = await createTestEnv()
    const { proc, port } = await spawnHttpServer(
      ['--http', '--model', 'claude-sonnet-4-6'],
      env.binaryEnv,
    )
    httpProc = proc
    BASE_URL = `http://127.0.0.1:${port}`
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
    const { proc: tokenProc, port: tokenPort } = await spawnHttpServer(
      ['--http', '--http-token', 'secret123', '--model', 'claude-sonnet-4-6'],
      env.binaryEnv,
    )
    try {
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
    const { proc: tokenProc, port: tokenPort } = await spawnHttpServer(
      ['--http', '--http-token', 'correct-token', '--model', 'claude-sonnet-4-6'],
      env.binaryEnv,
    )
    try {
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
