import { join } from 'path'
import type { AppContext } from '../bootstrap'
import { SessionManager, type SessionEvent } from '../web/session-manager'
import { loadWebPanels } from '../web/panels/loader'
import type { WebPanelDefinition } from '../web/panels/types'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Access-Control-Allow-Origin': '*',
}

const PING_INTERVAL_MS = 30_000

/**
 * Wrap a subscription callback in a server-sent-events Response.
 *
 * `setup(send)` is invoked once when the client connects; it should register
 * the `send` callback with whatever event source is relevant (session bus,
 * terminal listener, …) and return a cleanup function. The helper handles
 * the ReadableStream plumbing, the 30s keep-alive pings, and disconnect
 * detection (an enqueue on a closed controller throws — we treat that as
 * the client having gone away and run cleanup).
 */
/** Read a child-process stdio stream and fan each chunk out as a tagged event. */
async function pipeToListeners(
  stream: ReadableStream<Uint8Array> | null | undefined,
  type: 'stdout' | 'stderr',
  dispatch: (event: { type: 'stdout' | 'stderr'; data: string }) => void,
): Promise<void> {
  if (!stream) return
  const reader = (stream as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      dispatch({ type, data: decoder.decode(value) })
    }
  } catch { /* process ended */ }
}

function sseResponse<T>(setup: (send: (event: T) => void) => () => void): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      let closed = false
      const tryEnqueue = (chunk: string): boolean => {
        if (closed) return false
        try {
          controller.enqueue(encoder.encode(chunk))
          return true
        } catch {
          closed = true
          return false
        }
      }
      const send = (event: T) => {
        tryEnqueue(`data: ${JSON.stringify(event)}\n\n`)
      }

      const cleanup = setup(send)

      const ping = setInterval(() => {
        if (!tryEnqueue(': ping\n\n')) {
          clearInterval(ping)
          cleanup()
        }
      }, PING_INTERVAL_MS)
    },
  })
  return new Response(stream, { headers: SSE_HEADERS })
}

export interface WebServerOptions {
  port: number
  staticDir?: string
}

export class WebServer {
  private server: ReturnType<typeof Bun.serve> | null = null
  private app: AppContext
  private sessions: SessionManager
  private options: WebServerOptions
  private terminals = new Map<string, { proc: any; listeners: Set<(event: any) => void> }>()
  private webPanelById = new Map<string, WebPanelDefinition>()

  constructor(app: AppContext, options: WebServerOptions) {
    this.app = app
    this.options = options
    this.sessions = new SessionManager(app)
  }

  get port(): number {
    return (this.server?.port ?? this.options.port) as number
  }

  async start(): Promise<void> {
    // Restore previously persisted sessions from disk
    await this.sessions.restore()

    try {
      const panels = await loadWebPanels(
        this.app.config.agent.web.panels,
        this.app.config.app.configDir,
        this.app.logger,
      )
      this.webPanelById = new Map(panels.map(p => [p.id, p]))
      this.app.logger.info('web panels loaded', { count: panels.length, ids: panels.map(p => p.id) })
    } catch (err) {
      this.app.logger.error('web panels failed to load', {
        error: err instanceof Error ? err.message : String(err),
      })
      this.webPanelById = new Map()
    }

    const staticDir = this.options.staticDir

    this.server = Bun.serve({
      port: this.options.port,
      idleTimeout: 0,
      fetch: async (req: Request): Promise<Response> => {
        const url = new URL(req.url)
        const path = url.pathname

        // CORS preflight
        if (req.method === 'OPTIONS') {
          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
          })
        }

        // ── API routes ───────────────────────────────────────────

        // GET /api/web/panels — enabled session sidebar panels
        if (path === '/api/web/panels' && req.method === 'GET') {
          return json({ panels: this.listWebPanels() })
        }

        // List sessions
        if (path === '/api/sessions' && req.method === 'GET') {
          return json(this.sessions.list())
        }

        // Create session
        if (path === '/api/sessions' && req.method === 'POST') {
          try {
            const body = await req.json() as {
              message?: string
              worktree?: boolean
              branch?: string
              attachments?: Array<{ data: string; mimeType: string; name?: string }>
            }
            if (!body.message && (!body.attachments || body.attachments.length === 0)) {
              return json({ error: 'message or attachments required' }, 400)
            }
            const session = await this.sessions.create(body.message ?? '', {
              worktree: body.worktree,
              branch: body.branch,
              attachments: body.attachments,
            })
            return json(session, 201)
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : 'Failed to create session' }, 500)
          }
        }

        // Session-scoped routes
        const sessionMatch = path.match(/^\/api\/sessions\/([^/]+)(?:\/(.+))?$/)
        if (sessionMatch) {
          const [, id, action] = sessionMatch

          // GET /api/sessions/:id — session info
          if (!action && req.method === 'GET') {
            const session = this.sessions.get(id as string)
            if (!session) return json({ error: 'Session not found' }, 404)
            return json(session)
          }

          // DELETE /api/sessions/:id
          if (!action && req.method === 'DELETE') {
            await this.sessions.delete(id as string)
            return json({ ok: true })
          }

          // GET /api/sessions/:id/messages
          if (action === 'messages' && req.method === 'GET') {
            const messages = await this.sessions.getMessages(id as string)
            return json(messages)
          }

          // POST /api/sessions/:id/messages — send a message
          if (action === 'messages' && req.method === 'POST') {
            try {
              const body = await req.json() as {
                message?: string
                attachments?: Array<{ data: string; mimeType: string; name?: string }>
              }
              if (!body.message && (!body.attachments || body.attachments.length === 0)) {
                return json({ error: 'message or attachments required' }, 400)
              }
              await this.sessions.send(id as string, body.message ?? '', body.attachments)
              return json({ ok: true })
            } catch (err) {
              return json({ error: err instanceof Error ? err.message : 'Failed to send message' }, 500)
            }
          }

          // POST /api/sessions/:id/stop
          if (action === 'stop' && req.method === 'POST') {
            this.sessions.stop(id as string)
            return json({ ok: true })
          }

          // POST /api/sessions/:id/done — mark as done without requiring the
          // session to be running (aborts + flips status if it is).
          if (action === 'done' && req.method === 'POST') {
            this.sessions.markDone(id as string)
            return json({ ok: true })
          }

          // GET /api/sessions/:id/events — SSE stream
          if (action === 'events' && req.method === 'GET') {
            return this.handleSSE(id as string)
          }

          // GET /api/sessions/:id/stats
          if (action === 'stats' && req.method === 'GET') {
            const session = this.sessions.get(id as string)
            if (!session) return json({ error: 'Session not found' }, 404)
            return json({
              iteration: session.iteration,
              tokenUsage: session.tokenUsage,
              currentTool: session.currentTool,
              status: session.status,
            })
          }

          // /api/sessions/:id/panels/:panelId/... — plugin panel APIs
          const panelMatch = action?.match(/^panels\/([^/]+)(\/.*)?$/)
          if (panelMatch) {
            const [, panelId, subpath = '/'] = panelMatch
            const panel = this.webPanelById.get(panelId!)
            if (!panel?.handleRequest) return json({ error: 'Panel not found' }, 404)

            const session = this.sessions.get(id as string)
            if (!session) return json({ error: 'Session not found' }, 404)

            const res = await panel.handleRequest(req, {
              session,
              sessions: this.sessions,
              subpath,
              logger: this.app.logger,
            })
            return res ?? json({ error: 'Not Found' }, 404)
          }
        }

        // GET /api/config — current config summary
        if (path === '/api/config' && req.method === 'GET') {
          return json(this.buildConfigSummary())
        }

        // PUT /api/config — update in-memory config
        if (path === '/api/config' && req.method === 'PUT') {
          try {
            const body = await req.json() as Record<string, unknown>
            this.applyConfigUpdate(body)
            return json(this.buildConfigSummary())
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : 'Failed to update config' }, 500)
          }
        }

        // GET /api/tools — list all registered tools
        if (path === '/api/tools' && req.method === 'GET') {
          return json(this.listTools())
        }

        // GET /api/middleware — list all middleware hooks
        if (path === '/api/middleware' && req.method === 'GET') {
          return json(this.listMiddleware())
        }

        // GET /api/providers — list available providers + models
        if (path === '/api/providers' && req.method === 'GET') {
          return json(this.listProviders())
        }

        // ── Terminal routes ────────────────────────────────────

        // POST /api/terminal — spawn a command, return { id }
        if (path === '/api/terminal' && req.method === 'POST') {
          return await this.handleTerminalCreate(req)
        }

        // Terminal-scoped routes
        const termMatch = path.match(/^\/api\/terminal\/([^/]+)\/(.+)$/)
        if (termMatch) {
          const [, termId, termAction] = termMatch
          const id = termId as string

          if (termAction === 'stream' && req.method === 'GET') {
            return this.handleTerminalStream(id)
          }

          const entry = this.terminals.get(id)
          if (!entry) return json({ error: 'Terminal not found' }, 404)

          if (termAction === 'kill' && req.method === 'POST') {
            entry.proc.kill()
            return json({ ok: true })
          }

          if (termAction === 'stdin' && req.method === 'POST') {
            const body = await req.json() as { data: string }
            entry.proc.stdin?.write(new TextEncoder().encode(body.data))
            return json({ ok: true })
          }
        }

        // ── Static file serving ──────────────────────────────────

        if (staticDir) {
          let filePath: string
          if (path === '/' || path === '/index.html') {
            filePath = join(staticDir, 'index.html')
          } else {
            filePath = join(staticDir, path)
          }

          const file = Bun.file(filePath)
          if (await file.exists()) {
            return new Response(file)
          }

          // SPA fallback — serve index.html for non-API, non-file routes
          if (!path.startsWith('/api/')) {
            const index = Bun.file(join(staticDir, 'index.html'))
            if (await index.exists()) {
              return new Response(index)
            }
          }
        }

        return json({ error: 'Not Found' }, 404)
      },
    })
  }

  private handleSSE(sessionId: string): Response {
    return sseResponse<SessionEvent>(send => {
      // Replay current status/stats so a late-connecting client can paint without waiting.
      const info = this.sessions.get(sessionId)
      if (info) {
        send({ type: 'status', status: info.status, name: info.name })
        send({
          type: 'stats',
          usage: info.tokenUsage,
          iteration: info.iteration,
          currentTool: info.currentTool,
        })
      }
      return this.sessions.subscribe(sessionId, send)
    })
  }

  private async handleTerminalCreate(req: Request): Promise<Response> {
    const body = await req.json() as { command: string; cwd?: string }
    if (!body.command) return json({ error: 'command required' }, 400)

    const terminalId = crypto.randomUUID()
    const proc = Bun.spawn(['bash', '-c', body.command], {
      cwd: body.cwd || process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
    })

    const listeners = new Set<(event: unknown) => void>()
    this.terminals.set(terminalId, { proc, listeners })

    const dispatch = (event: unknown) => {
      for (const send of listeners) send(event)
    }

    // Fan stdout/stderr out to subscribers.
    pipeToListeners(proc.stdout, 'stdout', dispatch)
    pipeToListeners(proc.stderr, 'stderr', dispatch)

    // Emit exit and retain the entry briefly so late-connecting streams
    // still see the exit event before we drop the listener set.
    proc.exited.then(code => {
      dispatch({ type: 'exit', code: code ?? 1 })
      setTimeout(() => this.terminals.delete(terminalId), 5000)
    })

    return json({ id: terminalId })
  }

  private handleTerminalStream(terminalId: string): Response {
    const entry = this.terminals.get(terminalId)
    if (!entry) return json({ error: 'Terminal not found' }, 404)
    return sseResponse(send => {
      entry.listeners.add(send)
      return () => entry.listeners.delete(send)
    })
  }

  async stop(): Promise<void> {
    // Kill all running terminal processes
    for (const [, entry] of this.terminals) {
      try { entry.proc.kill() } catch {}
    }
    this.terminals.clear()

    await this.sessions.shutdown()
    if (this.server) {
      this.server.stop(true)
      this.server = null
    }
  }

  private buildConfigSummary() {
    const c = this.app.config.agent
    const raw = JSON.parse(JSON.stringify(this.app.config))

    // Redact secrets before sending to the client.
    for (const p of Object.values(raw.app?.providers ?? {}) as Array<Record<string, unknown>>) {
      if (p && 'apiKey' in p) p.apiKey = '***'
    }
    if (raw.app?.http?.token) raw.app.http.token = '***'

    return {
      provider: c.provider,
      model: c.model,
      thinking: c.thinking ?? 'off',
      systemPrompt: c.systemPrompt,
      maxIterations: c.maxIterations,
      toolTimeout: c.toolTimeout,
      parallelToolCalls: c.parallelToolCalls,
      maxTokenBudget: c.maxTokenBudget,
      maxDuration: c.maxDuration,
      raw,
    }
  }

  private applyConfigUpdate(updates: Record<string, unknown>): void {
    const c = this.app.config.agent
    if (typeof updates.provider === 'string') c.provider = updates.provider as typeof c.provider
    if (typeof updates.model === 'string') c.model = updates.model
    if (typeof updates.systemPrompt === 'string') c.systemPrompt = updates.systemPrompt
    if (typeof updates.thinking === 'string') {
      c.thinking = updates.thinking as typeof c.thinking
    }
    if (typeof updates.maxIterations === 'number') c.maxIterations = updates.maxIterations
    if (typeof updates.toolTimeout === 'number') c.toolTimeout = updates.toolTimeout
    if (typeof updates.parallelToolCalls === 'boolean') c.parallelToolCalls = updates.parallelToolCalls
    if (typeof updates.maxTokenBudget === 'number') c.maxTokenBudget = updates.maxTokenBudget
    if (typeof updates.maxDuration === 'number') c.maxDuration = updates.maxDuration
  }

  private listTools() {
    const overrides = this.app.config.agent.tools.overrides ?? {}
    return this.app.tools.all().map(tool => {
      const override = overrides[tool.name] as { enabled?: boolean } | undefined
      let source: 'builtin' | 'custom' | 'mcp' = 'builtin'
      if (tool.name.includes('__')) source = 'mcp'
      return {
        name: tool.name,
        description: tool.description,
        schema: tool.inputSchema,
        source,
        enabled: override?.enabled !== false,
      }
    })
  }

  private listMiddleware() {
    const hooks = [
      'beforeLoopBegin', 'beforeModelCall', 'onStreamChunk', 'afterModelResponse',
      'beforeToolExecution', 'afterToolExecution', 'afterLoopIteration', 'afterLoopComplete', 'onError',
    ] as const
    return hooks.map(hook => {
      const fns = (this.app.middleware as Record<string, Array<{ name?: string }> | undefined>)[hook] ?? []
      return {
        hook,
        names: fns.map(fn => fn.name || '(anonymous)'),
      }
    })
  }

  private listWebPanels(): Array<{ id: string; title: string; source: string }> {
    return [...this.webPanelById.values()].map(({ id, title, source }) => ({ id, title, source }))
  }

  private listProviders() {
    const providers = this.app.config.app.providers as Record<string, { apiKey?: string; host?: string; endpoint?: string }> | undefined
    return PROVIDER_ORDER.map(name => {
      const cfg = providers?.[name]
      // ollama defaults its host; bedrock uses the AWS credential chain.
      const hasCredentials = Boolean(
        cfg?.apiKey || cfg?.host || cfg?.endpoint || name === 'ollama' || name === 'bedrock',
      )
      return { name, models: MODELS_BY_PROVIDER[name] ?? [], hasCredentials }
    })
  }
}

interface ModelEntry { name: string; inputTokenCostPer1M?: number; outputTokenCostPer1M?: number }

const MODELS_BY_PROVIDER: Record<string, ModelEntry[]> = {
  anthropic: [
    { name: 'claude-opus-4-5-20250929', inputTokenCostPer1M: 15, outputTokenCostPer1M: 75 },
    { name: 'claude-sonnet-4-5-20250929', inputTokenCostPer1M: 3, outputTokenCostPer1M: 15 },
    { name: 'claude-3-5-haiku-20241022', inputTokenCostPer1M: 0.80, outputTokenCostPer1M: 4 },
  ],
  openai: [
    { name: 'gpt-5', inputTokenCostPer1M: 10, outputTokenCostPer1M: 30 },
    { name: 'gpt-5-mini', inputTokenCostPer1M: 1.50, outputTokenCostPer1M: 6 },
    { name: 'o1', inputTokenCostPer1M: 15, outputTokenCostPer1M: 60 },
    { name: 'o1-mini', inputTokenCostPer1M: 1.10, outputTokenCostPer1M: 4.40 },
    { name: 'gpt-4o', inputTokenCostPer1M: 2.50, outputTokenCostPer1M: 10 },
    { name: 'gpt-4o-mini', inputTokenCostPer1M: 0.15, outputTokenCostPer1M: 0.60 },
  ],
  google: [
    { name: 'gemini-2.5-pro', inputTokenCostPer1M: 1.25, outputTokenCostPer1M: 10 },
    { name: 'gemini-2.5-flash', inputTokenCostPer1M: 0.15, outputTokenCostPer1M: 0.60 },
  ],
  ollama: [
    { name: 'llama3.3' },
    { name: 'qwen2.5-coder' },
    { name: 'deepseek-r1' },
  ],
  bedrock: [
    { name: 'anthropic.claude-sonnet-4-5-20250929-v1:0', inputTokenCostPer1M: 3, outputTokenCostPer1M: 15 },
  ],
  azure: [],
  codex: [
    { name: 'gpt-5', inputTokenCostPer1M: 10, outputTokenCostPer1M: 30 },
    { name: 'o1', inputTokenCostPer1M: 15, outputTokenCostPer1M: 60 },
  ],
}

const PROVIDER_ORDER = ['anthropic', 'openai', 'google', 'ollama', 'bedrock', 'azure', 'codex']
