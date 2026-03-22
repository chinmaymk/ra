import { join } from 'path'
import type { AppContext } from '../bootstrap'
import { discoverContextFiles } from '../context'
import { SessionStorage } from '../storage/sessions'
import { parseJsonlFile } from '../utils/files'
import { homeDir } from '../utils/paths'
import { cacheHitPercent } from '@chinmaymk/ra'
import inspectorHtml from './inspector.html' with { type: 'text' }
import faviconSvg from './favicon.svg' with { type: 'text' }

// ── Helpers ───────────────────────────────────────────────────────────

function numAttr(attrs: Record<string, unknown>, key: string): number {
  return (attrs[key] as number) || 0
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  })
}

// ── Stats aggregation ─────────────────────────────────────────────────

interface TraceSpan {
  name?: string
  spanId?: string
  parentSpanId?: string
  timestamp?: string
  durationMs?: number
  status?: string
  attributes?: Record<string, unknown>
  events?: Array<{ name: string; attributes?: Record<string, unknown> }>
}

function buildStats(traces: TraceSpan[], messages: Array<{ role?: string; toolCalls?: unknown[]; isError?: boolean; content?: unknown }>) {
  const loopSpan = traces.find(s => s.name === 'agent.loop')
  const iterations = traces.filter(s => s.name === 'agent.iteration')
  const modelCalls = traces.filter(s => s.name === 'agent.model_call')
  const toolExecs = traces.filter(s => s.name === 'agent.tool_execution')

  // Token totals from loop span or sum from model calls
  const la = loopSpan?.attributes || {}
  let inputTokens = numAttr(la, 'inputTokens')
  let outputTokens = numAttr(la, 'outputTokens')
  let thinkingTokens = 0
  let cacheReadTokens = numAttr(la, 'cacheReadTokens')
  let cacheCreationTokens = numAttr(la, 'cacheCreationTokens')
  for (const mc of modelCalls) {
    const a = mc.attributes || {}
    thinkingTokens += numAttr(a, 'thinkingTokens')
    // Fall back to summing if loop span didn't have totals
    if (!inputTokens) inputTokens += numAttr(a, 'inputTokens')
    if (!outputTokens) outputTokens += numAttr(a, 'outputTokens')
    if (!cacheReadTokens) cacheReadTokens += numAttr(a, 'cacheReadTokens')
    if (!cacheCreationTokens) cacheCreationTokens += numAttr(a, 'cacheCreationTokens')
  }

  // Tool frequency map
  const toolCounts: Record<string, { calls: number; errors: number; totalMs: number }> = {}
  for (const t of toolExecs) {
    const name = (t.attributes?.tool as string) || 'unknown'
    if (!toolCounts[name]) toolCounts[name] = { calls: 0, errors: 0, totalMs: 0 }
    toolCounts[name].calls++
    if (t.status === 'error') toolCounts[name].errors++
    toolCounts[name].totalMs += t.durationMs || 0
  }
  const tools = Object.entries(toolCounts)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.calls - a.calls)

  // Per-iteration breakdown
  const iterationStats = iterations.map((it, i) => {
    const a = modelCalls.find(m => m.parentSpanId === it.spanId)?.attributes || {}
    const input = numAttr(a, 'inputTokens')
    const cacheRead = numAttr(a, 'cacheReadTokens')
    const tools = toolExecs.filter(t => t.parentSpanId === it.spanId)
    return {
      iteration: i + 1,
      durationMs: it.durationMs || 0,
      inputTokens: input,
      outputTokens: numAttr(a, 'outputTokens'),
      thinkingTokens: numAttr(a, 'thinkingTokens'),
      cacheReadTokens: cacheRead,
      cacheCreationTokens: numAttr(a, 'cacheCreationTokens'),
      cacheHitPercent: cacheHitPercent(input, cacheRead || undefined),
      toolCalls: tools.length,
      toolErrors: tools.filter(t => t.status === 'error').length,
      toolNames: tools.map(t => (t.attributes?.tool as string) || '?'),
    }
  })

  // Error count from messages
  const errorMessages = messages.filter(m => m.isError)

  return {
    totalDurationMs: loopSpan?.durationMs || iterations.reduce((s, i) => s + (i.durationMs || 0), 0),
    iterations: iterations.length,
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheHitPercent: cacheHitPercent(inputTokens, cacheReadTokens || undefined),
    totalTokens: inputTokens + outputTokens + thinkingTokens,
    totalToolCalls: toolExecs.length,
    totalToolErrors: toolExecs.filter(t => t.status === 'error').length,
    totalMessages: messages.length,
    errorMessages: errorMessages.length,
    tools,
    iterationStats,
    status: loopSpan?.status || (traces.some(s => s.status === 'error') ? 'error' : 'ok'),
  }
}

// ── Timeline builder ──────────────────────────────────────────────────

interface LogEntry {
  timestamp?: string
  level?: string
  message?: string
  [key: string]: unknown
}

function buildTimeline(traces: TraceSpan[], logs: LogEntry[]) {
  const events: Array<{ ts: string; type: string; label: string; detail?: string; status?: string; durationMs?: number }> = []

  // From traces — start events for key spans
  for (const span of traces) {
    if (!span.timestamp) continue
    const name = span.name || ''
    if (name === 'agent.loop') {
      events.push({ ts: span.timestamp, type: 'loop', label: 'Loop started', status: span.status, durationMs: span.durationMs })
    } else if (name === 'agent.iteration') {
      const it = (span.attributes?.iteration as number) ?? '?'
      events.push({ ts: span.timestamp, type: 'iteration', label: 'Iteration ' + it, status: span.status, durationMs: span.durationMs })
    } else if (name === 'agent.model_call') {
      const a = span.attributes || {}
      const model = (a.model as string) || ''
      const inTok = numAttr(a, 'inputTokens')
      const outTok = numAttr(a, 'outputTokens')
      const cacheRead = numAttr(a, 'cacheReadTokens')
      const cachePct = cacheHitPercent(inTok, cacheRead || undefined)
      const cacheDetail = cachePct ? ' (' + cachePct + '% cached)' : ''
      events.push({
        ts: span.timestamp, type: 'model_call', label: 'Model call' + (model ? ' (' + model + ')' : ''),
        detail: inTok + ' in / ' + outTok + ' out tokens' + cacheDetail,
        status: span.status, durationMs: span.durationMs,
      })
    } else if (name === 'agent.tool_execution') {
      const tool = (span.attributes?.tool as string) || '?'
      const err = span.status === 'error' ? (span.attributes?.error as string) : undefined
      events.push({
        ts: span.timestamp, type: 'tool', label: 'Tool: ' + tool,
        detail: err || undefined,
        status: span.status, durationMs: span.durationMs,
      })
    }
  }

  // From logs — warn and error entries
  for (const log of logs) {
    const level = (log.level || '').toLowerCase()
    if (level === 'error' || level === 'warn') {
      events.push({
        ts: log.timestamp || '',
        type: 'log_' + level,
        label: '[' + level.toUpperCase() + '] ' + (log.message || ''),
        detail: Object.keys(log).filter(k => !['timestamp', 'level', 'message', 'sessionId'].includes(k))
          .map(k => k + '=' + JSON.stringify(log[k])).join(' ') || undefined,
      })
    }
  }

  events.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''))
  return events
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
      const logs = await parseJsonlFile(join(dir, 'logs.jsonl')) as LogEntry[]
      return json(buildTimeline(traces, logs))
    }
    default: return json({ error: 'Unknown view' }, 404)
  }
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

        // ── Session-scoped API ──
        if (path === '/api/sessions') {
          const all = url.searchParams.get('all') === 'true'
          const sessions = all
            ? await SessionStorage.listAll(join(homeDir(), '.ra'))
            : await storage.list()
          sessions.sort((a, b) => new Date(b.meta.created).getTime() - new Date(a.meta.created).getTime())
          return json(sessions)
        }

        // Namespace-aware route: /api/sessions/:namespace/:id/:view
        const nsSessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/([^/]+)\/(\w+)$/)
        if (nsSessionMatch) {
          const [, ns, id, view] = nsSessionMatch
          const dir = join(homeDir(), '.ra', ns as string, 'sessions', id as string)
          try {
            return await serveSessionView(dir, id as string, view as string, storage)
          } catch {
            return json({ error: 'Session not found' }, 404)
          }
        }

        // Legacy route: /api/sessions/:id/:view (current namespace)
        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/(\w+)$/)
        if (sessionMatch) {
          const [, id, view] = sessionMatch
          const dir = storage.sessionDir(id as string)
          try {
            return await serveSessionView(dir, id as string, view as string, storage)
          } catch {
            return json({ error: 'Session not found' }, 404)
          }
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

        // ── Global API ──

        if (path === '/api/config') {
          return json(sanitizeConfig(config))
        }

        if (path === '/api/context') {
          const files = config.agent.context.enabled
            ? await discoverContextFiles({ cwd: config.app.configDir, patterns: config.agent.context.patterns })
            : []
          return json({ patterns: config.agent.context.patterns, files })
        }

        if (path === '/api/middleware') {
          const hooks: Record<string, string[]> = {}
          for (const [name, fns] of Object.entries(this.app.middleware)) {
            if (fns && fns.length > 0) {
              hooks[name] = fns.map(fn => fn.name || '(anonymous)')
            }
          }
          return json({ hooks, configMiddleware: config.agent.middleware })
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
