import { join, dirname } from 'path'
import type { AppContext } from '../bootstrap'
import { discoverContextFiles } from '../context'

const HTML_PATH = join(dirname(new URL(import.meta.url).pathname), 'inspector.html')

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
    const htmlFile = Bun.file(HTML_PATH)

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

        // ── Global API ──
        if (path === '/api/memory') {
          if (!memoryStore) return json([])
          const q = url.searchParams.get('q') || undefined
          return json(q ? memoryStore.search(q, 100) : memoryStore.list(100))
        }

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

        // ── SPA ──
        if (path === '/' || path === '/index.html') {
          return new Response(htmlFile, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
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
