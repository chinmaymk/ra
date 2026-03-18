import { join } from 'path'
import type { AppContext } from '../bootstrap'
import { discoverContextFiles } from '../context'
import inspectorHtml from './inspector.html' with { type: 'text' }
import faviconSvg from '../../docs/site/public/favicon.svg' with { type: 'text' }

// ── Helpers ───────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

async function readJsonl(path: string): Promise<Response> {
  const file = Bun.file(path)
  if (!(await file.exists())) return json([])
  const text = await file.text()
  const entries = text
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
  return json(entries)
}

// ── Server ────────────────────────────────────────────────────────────

export class InspectorServer {
  private server: ReturnType<typeof Bun.serve> | null = null
  private app: AppContext

  constructor(app: AppContext) {
    this.app = app
  }

  get port(): number { return (this.server?.port ?? this.app.config.inspector.port) as number }

  async start(): Promise<void> {
    const { config, storage, memoryStore } = this.app

    this.server = Bun.serve({
      port: config.inspector.port,
      fetch: async (req: Request): Promise<Response> => {
        const url = new URL(req.url)
        const path = url.pathname

        // ── Session-scoped API ──
        if (path === '/api/sessions') {
          const sessions = await storage.list()
          sessions.sort((a, b) => new Date(b.meta.created).getTime() - new Date(a.meta.created).getTime())
          return json(sessions)
        }

        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/(\w+)$/)
        if (sessionMatch) {
          const [, id, view] = sessionMatch
          try {
            if (view === 'messages') return json(await storage.readMessages(id!))
            if (view === 'logs') return readJsonl(join(storage.sessionDir(id!), 'logs.jsonl'))
            if (view === 'traces') return readJsonl(join(storage.sessionDir(id!), 'traces.jsonl'))
          } catch {
            return json({ error: 'Session not found' }, 404)
          }
          return json({ error: 'Unknown view' }, 404)
        }

        // ── Memory CRUD ──
        if (path === '/api/memory') {
          if (req.method === 'GET') {
            if (!memoryStore) return json({ enabled: false, memories: [] })
            const q = url.searchParams.get('q') || undefined
            return json({ enabled: true, memories: q ? memoryStore.search(q, 100) : memoryStore.list(100) })
          }
          if (req.method === 'POST') {
            if (!memoryStore) return json({ error: 'Memory is not enabled. Add --memory or set memory.enabled in config.' }, 400)
            const body = await req.json() as { content?: string; tags?: string }
            if (!body.content) return json({ error: 'content is required' }, 400)
            return json(memoryStore.save(body.content, body.tags ?? ''))
          }
        }

        const memoryIdMatch = path.match(/^\/api\/memory\/(\d+)$/)
        if (memoryIdMatch && req.method === 'DELETE') {
          if (!memoryStore) return json({ error: 'Memory is not enabled.' }, 400)
          const id = parseInt(memoryIdMatch[1]!, 10)
          const deleted = memoryStore.deleteById(id)
          return deleted ? json({ ok: true }) : json({ error: 'Not found' }, 404)
        }

        // ── Global API ──

        if (path === '/api/config') {
          return json(sanitizeConfig(config))
        }

        if (path === '/api/context') {
          const files = config.context.enabled
            ? await discoverContextFiles({ cwd: config.configDir, patterns: config.context.patterns })
            : []
          return json({ patterns: config.context.patterns, files })
        }

        if (path === '/api/middleware') {
          const hooks: Record<string, string[]> = {}
          for (const [name, fns] of Object.entries(this.app.middleware)) {
            if (fns && fns.length > 0) {
              hooks[name] = fns.map(fn => fn.name || '(anonymous)')
            }
          }
          return json({ hooks, configMiddleware: config.middleware })
        }

        // ── Static assets ──
        if (path === '/favicon.svg') {
          return new Response(faviconSvg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } })
        }

        // ── SPA ──
        if (path === '/' || path === '/index.html') {
          return new Response(inspectorHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
        }

        return json({ error: 'Not Found' }, 404)
      },
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop(true)
      this.server = null
    }
  }
}

// ── Config sanitization ───────────────────────────────────────────────

function sanitizeConfig(config: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(config))
  if (copy.providers) {
    for (const p of Object.values(copy.providers)) {
      if (p && typeof p === 'object' && 'apiKey' in (p as Record<string, unknown>)) {
        (p as Record<string, unknown>).apiKey = '***'
      }
    }
  }
  if (copy.http?.token) copy.http.token = '***'
  return copy
}
