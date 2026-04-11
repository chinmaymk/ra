import { join } from 'path'
import type { AppContext } from '../bootstrap'
import { SessionManager, type SessionEvent } from '../web/session-manager'

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

          // GET /api/terminal/:id/stream — SSE stream of terminal output
          if (termAction === 'stream' && req.method === 'GET') {
            return this.handleTerminalStream(termId as string)
          }

          // POST /api/terminal/:id/kill
          if (termAction === 'kill' && req.method === 'POST') {
            const entry = this.terminals.get(termId as string)
            if (!entry) return json({ error: 'Terminal not found' }, 404)
            entry.proc.kill()
            return json({ ok: true })
          }

          // POST /api/terminal/:id/stdin
          if (termAction === 'stdin' && req.method === 'POST') {
            const entry = this.terminals.get(termId as string)
            if (!entry) return json({ error: 'Terminal not found' }, 404)
            const body = await req.json() as { data: string }
            if (entry.proc.stdin) {
              entry.proc.stdin.write(new TextEncoder().encode(body.data))
            }
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
    const sessions = this.sessions
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start(controller) {
        const send = (event: SessionEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            // Stream may be closed
          }
        }

        // Send current status immediately
        const info = sessions.get(sessionId)
        if (info) {
          send({ type: 'status', status: info.status, name: info.name })
          send({
            type: 'stats',
            usage: info.tokenUsage,
            iteration: info.iteration,
            currentTool: info.currentTool,
          })
        }

        const unsubscribe = sessions.subscribe(sessionId, send)

        // Keep-alive ping every 30s
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
          } catch {
            clearInterval(pingInterval)
            unsubscribe()
          }
        }, 30_000)

        // Cleanup when client disconnects (controller is closed externally)
        // ReadableStream doesn't have a direct "onclose" — rely on enqueue throwing
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  private async handleTerminalCreate(req: Request): Promise<Response> {
    const body = await req.json() as { command: string; cwd?: string }
    if (!body.command) return json({ error: 'command required' }, 400)

    const terminalId = crypto.randomUUID()
    const decoder = new TextDecoder()

    const proc = Bun.spawn(['bash', '-c', body.command], {
      cwd: body.cwd || process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'pipe',
    })

    const listeners = new Set<(event: unknown) => void>()
    this.terminals.set(terminalId, { proc, listeners })

    // Start reading stdout/stderr and dispatching to listeners
    const readStream = async (readable: ReadableStream<Uint8Array>, type: 'stdout' | 'stderr') => {
      const reader = readable.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const event = { type, data: decoder.decode(value) }
          for (const send of listeners) send(event)
        }
      } catch { /* process ended */ }
    }

    if (proc.stdout) readStream(proc.stdout as unknown as ReadableStream<Uint8Array>, 'stdout')
    if (proc.stderr) readStream(proc.stderr as unknown as ReadableStream<Uint8Array>, 'stderr')

    // Wait for exit
    proc.exited.then((code) => {
      const event = { type: 'exit', code: code ?? 1 }
      for (const send of listeners) send(event)
      // Clean up after a short delay so late-connecting streams can get the exit event
      setTimeout(() => this.terminals.delete(terminalId), 5000)
    })

    return json({ id: terminalId })
  }

  private handleTerminalStream(terminalId: string): Response {
    const entry = this.terminals.get(terminalId)
    if (!entry) return json({ error: 'Terminal not found' }, 404)

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      start: (controller) => {
        const send = (event: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch { /* stream closed */ }
        }

        entry.listeners.add(send)

        // Clean up when client disconnects
        const cleanup = () => {
          entry.listeners.delete(send)
        }

        // Keep-alive ping every 30s
        const pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
          } catch {
            clearInterval(pingInterval)
            cleanup()
          }
        }, 30_000)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      },
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
    // Sanitize secrets
    if (raw.app?.providers) {
      for (const p of Object.values(raw.app.providers)) {
        if (p && typeof p === 'object' && 'apiKey' in (p as Record<string, unknown>)) {
          (p as Record<string, unknown>).apiKey = '***'
        }
      }
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

  private listProviders() {
    const providers = this.app.config.app.providers as Record<string, { apiKey?: string; host?: string; endpoint?: string }> | undefined
    interface ModelEntry { name: string; inputTokenCostPer1M?: number; outputTokenCostPer1M?: number }
    const modelsByProvider: Record<string, ModelEntry[]> = {
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
    const names = ['anthropic', 'openai', 'google', 'ollama', 'bedrock', 'azure', 'codex']
    return names.map(name => {
      const cfg = providers?.[name]
      const hasCredentials = Boolean(
        cfg?.apiKey ||
        cfg?.host ||
        cfg?.endpoint ||
        name === 'ollama' || // host has a default
        name === 'bedrock' // uses AWS credential chain
      )
      return {
        name,
        models: modelsByProvider[name] ?? [],
        hasCredentials,
      }
    })
  }
}
