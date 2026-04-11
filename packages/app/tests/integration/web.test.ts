import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestEnv, type TestEnv } from './helpers/setup'
import { spawnWebBinary, type InteractiveProcess } from './helpers/binary'

/**
 * Ensures `ra web` serves the dashboard in the compiled binary. The dev path
 * reads packages/web/dist from disk; the binary path relies on web assets
 * being embedded via scripts/embed-web.ts during `bun run compile`.
 */
describe('web interface integration (compiled binary)', () => {
  let env: TestEnv
  let webProc: InteractiveProcess
  let BASE_URL: string

  beforeAll(async () => {
    env = await createTestEnv()
    const { proc, port } = await spawnWebBinary(env.binaryEnv)
    webProc = proc
    BASE_URL = `http://127.0.0.1:${port}`
  })

  afterAll(async () => {
    webProc?.kill()
    await env?.cleanup()
  })

  it('GET / serves index.html', async () => {
    const res = await fetch(`${BASE_URL}/`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<html')
    expect(body.toLowerCase()).toContain('</html>')
  })

  it('GET /index.html serves the same document', async () => {
    const res = await fetch(`${BASE_URL}/index.html`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<html')
  })

  it('GET /unknown/route falls back to index.html (SPA)', async () => {
    const res = await fetch(`${BASE_URL}/nope/does/not/exist`)
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<html')
  })

  it('GET /api/sessions returns JSON', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const data = await res.json() as unknown
    expect(Array.isArray(data)).toBe(true)
  })

  it('GET /api/unknown returns 404 (no SPA fallback under /api/)', async () => {
    const res = await fetch(`${BASE_URL}/api/definitely-missing`)
    expect(res.status).toBe(404)
  })
})
