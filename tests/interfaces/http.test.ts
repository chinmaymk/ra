import { describe, it, expect, afterEach } from 'bun:test'
import { HttpServer } from '../../src/interfaces/http'
import { ToolRegistry } from '../../src/agent/tool-registry'
import { SessionStorage } from '../../src/storage/sessions'
import type { IProvider } from '../../src/providers/types'

const TEST_STORAGE = '/tmp/ra-http-test'
const TEST_PORT = 13579

function mockProvider(text: string): IProvider {
  return {
    name: 'mock',
    chat: async () => { throw new Error() },
    async *stream() {
      yield { type: 'text', delta: text }
      yield { type: 'done' }
    },
  }
}

async function makeStorage(): Promise<SessionStorage> {
  const storage = new SessionStorage(TEST_STORAGE)
  await storage.init()
  return storage
}

describe('HttpServer', () => {
  let server: HttpServer

  afterEach(async () => {
    await server?.stop()
    await Bun.$`rm -rf ${TEST_STORAGE}`.quiet()
  })

  it('POST /chat/sync returns response', async () => {
    server = new HttpServer({
      port: TEST_PORT,
      model: 'test',
      provider: mockProvider('hello'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    const data = await res.json() as { response: string }
    expect(data.response).toBe('hello')
  })

  it('GET /sessions returns empty list', async () => {
    server = new HttpServer({
      port: TEST_PORT + 1,
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 1}/sessions`)
    const data = await res.json() as { sessions: unknown[] }
    expect(data.sessions).toBeDefined()
    expect(Array.isArray(data.sessions)).toBe(true)
  })

  it('returns 401 when token is wrong', async () => {
    server = new HttpServer({
      port: TEST_PORT + 2,
      token: 'secret',
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 2}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer wrong' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(401)
  })
})
