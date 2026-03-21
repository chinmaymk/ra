import { join } from 'path'
import type { AppContext } from '../bootstrap'
import { discoverContextFiles } from '../context'
import { parseJsonlFile } from '../utils/files'
import inspectorHtml from './inspector.html' with { type: 'text' }
import faviconSvg from './favicon.svg' with { type: 'text' }

// ── Helpers ───────────────────────────────────────────────────────────

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
  let inputTokens = 0
  let outputTokens = 0
  let thinkingTokens = 0
  if (loopSpan?.attributes) {
    inputTokens = (loopSpan.attributes.inputTokens as number) || 0
    outputTokens = (loopSpan.attributes.outputTokens as number) || 0
  }
  for (const mc of modelCalls) {
    const attrs = mc.attributes || {}
    thinkingTokens += (attrs.thinkingTokens as number) || 0
    // Fall back to summing if loop span didn't have totals
    if (!inputTokens) inputTokens += (attrs.inputTokens as number) || 0
    if (!outputTokens) outputTokens += (attrs.outputTokens as number) || 0
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
    const mc = modelCalls.find(m => m.parentSpanId === it.spanId)
    const attrs = mc?.attributes || {}
    const itTools = toolExecs.filter(t => t.parentSpanId === it.spanId)
    return {
      iteration: i + 1,
      durationMs: it.durationMs || 0,
      inputTokens: (attrs.inputTokens as number) || 0,
      outputTokens: (attrs.outputTokens as number) || 0,
      thinkingTokens: (attrs.thinkingTokens as number) || 0,
      toolCalls: itTools.length,
      toolErrors: itTools.filter(t => t.status === 'error').length,
      toolNames: itTools.map(t => (t.attributes?.tool as string) || '?'),
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
      const model = (span.attributes?.model as string) || ''
      const inTok = (span.attributes?.inputTokens as number) || 0
      const outTok = (span.attributes?.outputTokens as number) || 0
      events.push({
        ts: span.timestamp, type: 'model_call', label: 'Model call' + (model ? ' (' + model + ')' : ''),
        detail: inTok + ' in / ' + outTok + ' out tokens',
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
          const sessions = await storage.list()
          sessions.sort((a, b) => new Date(b.meta.created).getTime() - new Date(a.meta.created).getTime())
          return json(sessions)
        }

        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)\/(\w+)$/)
        if (sessionMatch) {
          const [, id, view] = sessionMatch
          const dir = storage.sessionDir(id!)
          try {
            switch (view) {
              case 'messages': return json(await storage.readMessages(id!))
              case 'logs':     return json(await parseJsonlFile(join(dir, 'logs.jsonl')))
              case 'traces':   return json(await parseJsonlFile(join(dir, 'traces.jsonl')))
              case 'stats': {
                const traces = await parseJsonlFile(join(dir, 'traces.jsonl')) as TraceSpan[]
                const messages = await storage.readMessages(id!) as Array<{ role?: string; toolCalls?: unknown[]; isError?: boolean; content?: unknown }>
                return json(buildStats(traces, messages))
              }
              case 'timeline': {
                const traces = await parseJsonlFile(join(dir, 'traces.jsonl')) as TraceSpan[]
                const logs = await parseJsonlFile(join(dir, 'logs.jsonl')) as LogEntry[]
                return json(buildTimeline(traces, logs))
              }
              default: return json({ error: 'Unknown view' }, 404)
            }
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
          const id = parseInt(memoryIdMatch[1]!, 10)
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
  if (copy.agent?.providers) {
    for (const p of Object.values(copy.agent.providers)) {
      if (p && typeof p === 'object' && 'apiKey' in (p as Record<string, unknown>)) {
        (p as Record<string, unknown>).apiKey = '***'
      }
    }
  }
  if (copy.app?.http?.token) copy.app.http.token = '***'
  return copy
}
