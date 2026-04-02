import { join } from 'path'
import type { AppContext } from '../bootstrap'
import { discoverContextFiles } from '../context'
import { SessionStorage } from '../storage/sessions'
import { parseJsonlFile } from '../utils/files'
import { homeDir } from '../utils/paths'
import { buildStats, buildTimeline, type TraceSpan } from './inspector-stats'
import inspectorHtml from './inspector.html' with { type: 'text' }
import faviconSvg from './favicon.svg' with { type: 'text' }

// ── Helpers ───────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// ── Session view helper ───────────────────────────────────────────────

async function serveSessionView(dir: string, id: string, view: string, storage: SessionStorage): Promise<Response> {
  switch (view) {
    case 'messages': {
      // Try reading via storage first (works for current namespace), fall back to direct file read
      try { return json(await storage.readMessages(id)) } catch { /* fall through */ }
      return json(await parseJsonlFile(join(dir, 'messages.jsonl')))
    }
    case 'logs':     return json(await parseJsonlFile(join(dir, 'logs.jsonl')))
    case 'traces':   return json(await parseJsonlFile(join(dir, 'traces.jsonl')))
    case 'stats': {
      const traces = await parseJsonlFile(join(dir, 'traces.jsonl')) as TraceSpan[]
      let messages: Array<{ role?: string; toolCalls?: unknown[]; isError?: boolean; content?: unknown }>
      try { messages = await storage.readMessages(id) as Array<{ role?: string; toolCalls?: unknown[]; isError?: boolean; content?: unknown }> } catch { messages = await parseJsonlFile(join(dir, 'messages.jsonl')) }
      return json(buildStats(traces, messages))
    }
    case 'timeline': {
      const traces = await parseJsonlFile(join(dir, 'traces.jsonl')) as TraceSpan[]
      const logs = await parseJsonlFile(join(dir, 'logs.jsonl')) as unknown[]
      return json(buildTimeline(traces, logs as Array<{ timestamp?: string; level?: string; message?: string }>))
    }
    default: return json({ error: 'Unknown view' }, 404)
  }
}

// ── Config sanitization ───────────────────────────────────────────────

function sanitizeConfig(config: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(config))
  if (copy.app?.providers) {
    for (const p of Object.values(copy.app.providers)) {
      if (p && typeof p === 'object' && 'apiKey' in (p as Record<string, unknown>)) {
        (p as Record<string, unknown>).apiKey = '***'
      }
    }
  }
  if (copy.app?.http?.token) copy.app.http.token = '***'
  return copy
}

// ── Server ────────────────────────────────────────────────────────────

export class InspectorServer {
  private server: ReturnType<typeof Bun.serve> | null = null
  private app: AppContext

  constructor(app: AppContext) {
    this.app = app
  }

  get port(): number { return (this.server?.port ?? this.app.config.app.inspector.port) as number }

  async start(): Promise<void> {
    const { config, storage, memoryStore } = this.app

    this.server = Bun.serve({
      port: config.app.inspector.port,
      fetch: async (req: Request): Promise<Response> => {
        const url = new URL(req.url)
        const path = url.pathname

        const globalDir = join(homeDir(), '.ra')

        // ── Session-scoped API ──
        if (path === '/api/sessions') {
          if (req.method === 'DELETE') {
            const all = url.searchParams.get('all') === 'true'
            if (all) {
              await SessionStorage.deleteAllGlobal(globalDir)
            } else {
              await storage.deleteAll()
            }
            return json({ ok: true })
          }
          const all = url.searchParams.get('all') === 'true'
          const sessions = all
            ? await SessionStorage.listAll(globalDir)
            : await storage.list()
          sessions.sort((a, b) => new Date(b.meta.created).getTime() - new Date(a.meta.created).getTime())
          return json(sessions)
        }

        // Delete handle: DELETE /api/handles/:namespace
        const handleMatch = path.match(/^\/api\/handles\/([^/]+)$/)
        if (handleMatch && req.method === 'DELETE') {
          const ns = handleMatch[1] as string
          await SessionStorage.deleteHandle(globalDir, ns)
          return json({ ok: true })
        }

        // Namespace-aware route: /api/sessions/:namespace/:id (DELETE or /:view GET)
        const nsSessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/([^/]+)(?:\/(\w+))?$/)
        if (nsSessionMatch) {
          const [, ns, id, view] = nsSessionMatch
          if (req.method === 'DELETE' && !view) {
            await SessionStorage.deleteFromNamespace(globalDir, ns as string, id as string)
            return json({ ok: true })
          }
          if (view) {
            const dir = join(globalDir, ns as string, 'sessions', id as string)
            try {
              return await serveSessionView(dir, id as string, view, storage)
            } catch {
              return json({ error: 'Session not found' }, 404)
            }
          }
        }

        // Legacy route: /api/sessions/:id/:view or DELETE /api/sessions/:id
        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(?:\/(\w+))?$/)
        if (sessionMatch) {
          const [, id, view] = sessionMatch
          if (req.method === 'DELETE' && !view) {
            try {
              await storage.delete(id as string)
              return json({ ok: true })
            } catch {
              return json({ error: 'Session not found' }, 404)
            }
          }
          if (view) {
            const dir = storage.sessionDir(id as string)
            try {
              return await serveSessionView(dir, id as string, view, storage)
            } catch {
              return json({ error: 'Session not found' }, 404)
            }
          }
        }

        // ── Handles API ──
        if (path === '/api/handles') {
          const handles = await SessionStorage.listHandles(globalDir)
          return json({ handles, current: this.app.namespace })
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
          const id = parseInt(memoryIdMatch[1] as string, 10)
          const deleted = memoryStore.deleteById(id)
          return deleted ? json({ ok: true }) : json({ error: 'Not found' }, 404)
        }

        // ── Handle-scoped API ──

        if (path === '/api/config' || path === '/api/context' || path === '/api/middleware') {
          const handle = url.searchParams.get('handle')
          const view = path.replace('/api/', '')

          // Current handle — serve live data
          if (!handle || handle === this.app.namespace) {
            if (view === 'config') return json(sanitizeConfig(config))
            if (view === 'context') {
              const files = config.agent.context.enabled
                ? await discoverContextFiles({ cwd: config.app.configDir, patterns: config.agent.context.patterns })
                : []
              return json({ patterns: config.agent.context.patterns, files })
            }
            if (view === 'middleware') {
              const hooks: Record<string, string[]> = {}
              for (const [name, fns] of Object.entries(this.app.middleware)) {
                if (fns && fns.length > 0) {
                  hooks[name] = fns.map(fn => fn.name || '(anonymous)')
                }
              }
              return json({ hooks, configMiddleware: config.agent.middleware })
            }
          }

          // Different handle — read from snapshot
          const snapshotPath = join(globalDir, handle as string, 'handle-snapshot.json')
          try {
            const snapshot = JSON.parse(await Bun.file(snapshotPath).text()) as Record<string, unknown>
            const data = snapshot[view]
            if (data) return json(data)
            return json({ error: 'No ' + view + ' data for handle ' + handle }, 404)
          } catch {
            return json({ error: 'No snapshot available for handle "' + handle + '". Run that project once to generate data.' }, 404)
          }
        }

        // ── Static assets ──
        if (path === '/favicon.svg') {
          return new Response(faviconSvg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } })
        }

        // ── SPA ──
        if (path === '/' || path === '/index.html') {
          return new Response(inspectorHtml.toString(), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
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
