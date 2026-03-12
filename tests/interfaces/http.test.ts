import { describe, it, expect, afterEach } from 'bun:test'
import { HttpServer } from '../../src/interfaces/http'
import { ToolRegistry } from '../../src/agent/tool-registry'
import { SessionStorage } from '../../src/storage/sessions'
import type { IProvider } from '../../src/providers/types'
import { tmpdir } from '../tmpdir'

const TEST_STORAGE = tmpdir('ra-http-test')
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

  it('allows request when correct token is provided', async () => {
    server = new HttpServer({
      port: TEST_PORT + 3,
      token: 'secret',
      model: 'test',
      provider: mockProvider('authorized'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 3}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer secret' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const data = await res.json() as { response: string }
    expect(data.response).toBe('authorized')
  })

  it('returns 404 for unknown routes', async () => {
    server = new HttpServer({
      port: TEST_PORT + 4,
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 4}/unknown`)
    expect(res.status).toBe(404)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Not Found')
  })

  it('returns 400 for invalid JSON body on /chat/sync', async () => {
    server = new HttpServer({
      port: TEST_PORT + 5,
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 5}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json{{{',
    })
    expect(res.status).toBe(400)
    const data = await res.json() as { error: string }
    expect(data.error).toBe('Invalid JSON')
  })

  it('returns 400 for invalid JSON body on /chat stream', async () => {
    server = new HttpServer({
      port: TEST_PORT + 6,
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 6}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid json',
    })
    expect(res.status).toBe(400)
  })

  it('POST /chat streams SSE text events', async () => {
    server = new HttpServer({
      port: TEST_PORT + 7,
      model: 'test',
      provider: mockProvider('streamed'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 7}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    const text = await res.text()
    expect(text).toContain('"type":"text"')
    expect(text).toContain('"type":"done"')
  })

  it('prepends system prompt when configured', async () => {
    let capturedMessages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        capturedMessages = req.messages
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }
    server = new HttpServer({
      port: TEST_PORT + 8,
      model: 'test',
      provider,
      tools: new ToolRegistry(),
      storage: await makeStorage(),
      systemPrompt: 'You are a helpful assistant',
    })
    await server.start()
    await fetch(`http://localhost:${TEST_PORT + 8}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(capturedMessages[0]?.role).toBe('system')
    expect(capturedMessages[0]?.content).toBe('You are a helpful assistant')
  })

  it('stop is idempotent when server not started', async () => {
    server = new HttpServer({
      port: TEST_PORT + 9,
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    // stop without start should not throw
    await server.stop()
  })

  it('returns 401 when no Authorization header and token required', async () => {
    server = new HttpServer({
      port: TEST_PORT + 10,
      token: 'secret',
      model: 'test',
      provider: mockProvider('ok'),
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 10}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(401)
  })

  it('POST /chat sends error event when provider throws', async () => {
    const errorProvider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('Provider error') },
      async *stream() {
        throw new Error('Provider error')
      },
    }
    server = new HttpServer({
      port: TEST_PORT + 11,
      model: 'test',
      provider: errorProvider,
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 11}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"type":"error"')
    expect(text).toContain('Provider error')
    // Should NOT contain a done event (error replaces it)
    expect(text).not.toContain('"type":"done"')
  })

  it('POST /chat/sync returns 500 JSON when provider throws', async () => {
    const errorProvider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error('sync explosion') },
      async *stream() {
        throw new Error('sync explosion')
      },
    }
    server = new HttpServer({
      port: TEST_PORT + 13,
      model: 'test',
      provider: errorProvider,
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 13}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(500)
    const data = await res.json() as { error: string }
    expect(data.error).toContain('sync explosion')
  })

  it('prepends context messages when configured', async () => {
    let capturedMessages: any[] = []
    const provider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream(req) {
        capturedMessages = req.messages
        yield { type: 'text', delta: 'ok' }
        yield { type: 'done' }
      },
    }
    server = new HttpServer({
      port: TEST_PORT + 14,
      model: 'test',
      provider,
      tools: new ToolRegistry(),
      storage: await makeStorage(),
      systemPrompt: 'sys',
      contextMessages: [
        { role: 'user', content: '<context-file path="README.md">hello</context-file>' },
      ],
    })
    await server.start()
    await fetch(`http://localhost:${TEST_PORT + 14}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    // system prompt first, then context message, then user message
    expect(capturedMessages[0]?.role).toBe('system')
    expect(capturedMessages[1]?.role).toBe('user')
    expect(capturedMessages[1]?.content).toContain('context-file')
    expect(capturedMessages[2]?.role).toBe('user')
    expect(capturedMessages[2]?.content).toBe('hi')
  })

  it('POST /chat/sync extracts text from ContentPart[] responses', async () => {
    const arrayContentProvider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        // The AgentLoop will accumulate text and push an assistant message
        yield { type: 'text' as const, delta: 'part1 ' }
        yield { type: 'text' as const, delta: 'part2' }
        yield { type: 'done' as const }
      },
    }
    server = new HttpServer({
      port: TEST_PORT + 12,
      model: 'test',
      provider: arrayContentProvider,
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 12}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    const data = await res.json() as { response: string }
    expect(data.response).toBe('part1 part2')
  })

  it('POST /chat/sync returns model response when ask_user is called (no special field)', async () => {
    let callCount = 0
    const askProvider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        if (callCount++ === 0) {
          yield { type: 'tool_call_start' as const, id: 'tc1', name: 'ask_user' }
          yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{"question":"What color?"}' }
          yield { type: 'tool_call_end' as const, id: 'tc1' }
          yield { type: 'done' as const }
        } else {
          yield { type: 'text' as const, delta: 'ok' }
          yield { type: 'done' as const }
        }
      },
    }
    server = new HttpServer({
      port: TEST_PORT + 15,
      model: 'test',
      provider: askProvider,
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 15}/chat/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    const data = await res.json() as Record<string, unknown>
    expect(data.askUser).toBeUndefined()
    expect(typeof data.response).toBe('string')
  })

  it('POST /chat streams tool_call_start events so client can handle ask_user', async () => {
    let callCount = 0
    const askProvider: IProvider = {
      name: 'mock',
      chat: async () => { throw new Error() },
      async *stream() {
        if (callCount++ === 0) {
          yield { type: 'tool_call_start' as const, id: 'tc1', name: 'ask_user' }
          yield { type: 'tool_call_delta' as const, id: 'tc1', argsDelta: '{"question":"What color?"}' }
          yield { type: 'tool_call_end' as const, id: 'tc1' }
          yield { type: 'done' as const }
        } else {
          yield { type: 'text' as const, delta: 'ok' }
          yield { type: 'done' as const }
        }
      },
    }
    server = new HttpServer({
      port: TEST_PORT + 16,
      model: 'test',
      provider: askProvider,
      tools: new ToolRegistry(),
      storage: await makeStorage(),
    })
    await server.start()
    const res = await fetch(`http://localhost:${TEST_PORT + 16}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('"type":"tool_call_start"')
    expect(text).toContain('"name":"ask_user"')
    expect(text).toContain('"type":"done"')
  })
})
