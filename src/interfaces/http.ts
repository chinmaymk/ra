import type { IProvider, IMessage } from '../providers/types'
import type { MiddlewareConfig, StreamChunkContext } from '../agent/types'
import type { ToolRegistry } from '../agent/tool-registry'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import type { CompactionConfig } from '../agent/context-compaction'
import { AgentLoop } from '../agent/loop'
import { logger } from '../utils/logger'
import { RateLimiter } from '../utils/rate-limiter'
import { randomUUID } from 'crypto'

/** Maximum request body size in bytes (default 1MB) */
const MAX_BODY_SIZE = parseInt(process.env.RA_HTTP_MAX_BODY_SIZE || '1048576', 10)

export interface HttpOptions {
  port: number
  token?: string
  model: string
  provider: IProvider
  tools: ToolRegistry
  storage: SessionStorage
  systemPrompt?: string
  skillMap?: Map<string, Skill>
  middleware?: Partial<MiddlewareConfig>
  maxIterations?: number
  toolTimeout?: number
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
  corsOrigins?: string
  rateLimitMax?: number
  rateLimitWindowMs?: number
}

export class HttpServer {
  private options: HttpOptions
  private server: ReturnType<typeof Bun.serve> | null = null
  private startTime = Date.now()
  private requestCount = 0
  private activeRequests = 0
  private rateLimiter: RateLimiter
  private shuttingDown = false
  private log = logger.child({ component: 'http' })

  constructor(options: HttpOptions) {
    this.options = options
    this.rateLimiter = new RateLimiter({
      maxRequests: options.rateLimitMax ?? parseInt(process.env.RA_HTTP_RATE_LIMIT_MAX || '100', 10),
      windowMs: options.rateLimitWindowMs ?? parseInt(process.env.RA_HTTP_RATE_LIMIT_WINDOW_MS || '60000', 10),
    })
  }

  get port(): number { return (this.server?.port ?? this.options.port) as number }

  async start(): Promise<void> {
    const opts = this.options
    const corsOrigins = opts.corsOrigins ?? process.env.RA_HTTP_CORS_ORIGINS ?? ''

    this.server = Bun.serve({
      port: opts.port,
      fetch: async (req: Request): Promise<Response> => {
        const requestId = req.headers.get('X-Request-ID') || randomUUID()
        const url = new URL(req.url)
        const startMs = Date.now()
        this.requestCount++
        this.activeRequests++

        const reqLog = this.log.child({ requestId, method: req.method, path: url.pathname })

        try {
          // CORS preflight
          if (req.method === 'OPTIONS') {
            return this.corsResponse(new Response(null, { status: 204 }), corsOrigins, requestId)
          }

          // Health/readiness (no auth required)
          if (req.method === 'GET' && url.pathname === '/health') {
            return this.corsResponse(this.handleHealth(requestId), corsOrigins, requestId)
          }
          if (req.method === 'GET' && url.pathname === '/ready') {
            return this.corsResponse(this.handleReady(requestId), corsOrigins, requestId)
          }

          // Reject during graceful shutdown
          if (this.shuttingDown) {
            return this.corsResponse(this.jsonResponse(503, { error: 'Server is shutting down' }, requestId), corsOrigins, requestId)
          }

          // Rate limiting
          const clientIp = req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'
          const rateCheck = this.rateLimiter.check(clientIp)
          if (!rateCheck.allowed) {
            reqLog.warn('Rate limited', { clientIp })
            const res = this.jsonResponse(429, { error: 'Too Many Requests' }, requestId)
            res.headers.set('Retry-After', String(Math.ceil(rateCheck.resetMs / 1000)))
            res.headers.set('X-RateLimit-Remaining', '0')
            return this.corsResponse(res, corsOrigins, requestId)
          }

          // Auth check
          if (opts.token) {
            const authHeader = req.headers.get('Authorization') ?? ''
            const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
            if (provided !== opts.token) {
              reqLog.warn('Unauthorized request')
              return this.corsResponse(this.jsonResponse(401, { error: 'Unauthorized' }, requestId), corsOrigins, requestId)
            }
          }

          // Route
          let response: Response
          if (req.method === 'POST' && url.pathname === '/chat/sync') {
            response = await this.handleChatSync(req, requestId)
          } else if (req.method === 'POST' && url.pathname === '/chat') {
            response = await this.handleChatStream(req, requestId)
          } else if (req.method === 'GET' && url.pathname === '/sessions') {
            response = await this.handleSessions(requestId)
          } else {
            response = this.jsonResponse(404, { error: 'Not Found' }, requestId)
          }

          reqLog.info('Request completed', { status: response.status, durationMs: Date.now() - startMs })
          return this.corsResponse(response, corsOrigins, requestId)
        } catch (err) {
          reqLog.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) })
          return this.corsResponse(this.jsonResponse(500, { error: 'Internal Server Error' }, requestId), corsOrigins, requestId)
        } finally {
          this.activeRequests--
        }
      },
    })
  }

  async stop(): Promise<void> {
    this.shuttingDown = true
    this.log.info('Graceful shutdown initiated', { activeRequests: this.activeRequests })

    // Wait for in-flight requests (up to 30s)
    const deadline = Date.now() + 30_000
    while (this.activeRequests > 0 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250))
    }

    if (this.activeRequests > 0) {
      this.log.warn('Forcing shutdown with active requests', { activeRequests: this.activeRequests })
    }

    if (this.server) {
      this.server.stop(true)
      this.server = null
    }
    this.rateLimiter.destroy()
    this.log.info('Server stopped')
  }

  private jsonResponse(status: number, body: unknown, requestId: string): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
      },
    })
  }

  private corsResponse(res: Response, origins: string, requestId: string): Response {
    if (origins) {
      res.headers.set('Access-Control-Allow-Origin', origins)
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID')
      res.headers.set('Access-Control-Expose-Headers', 'X-Request-ID, X-RateLimit-Remaining, Retry-After')
      res.headers.set('Access-Control-Max-Age', '86400')
    }
    if (!res.headers.has('X-Request-ID')) {
      res.headers.set('X-Request-ID', requestId)
    }
    return res
  }

  private handleHealth(requestId: string): Response {
    return this.jsonResponse(200, {
      status: 'ok',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
    }, requestId)
  }

  private handleReady(requestId: string): Response {
    if (this.shuttingDown) {
      return this.jsonResponse(503, { status: 'shutting_down' }, requestId)
    }
    return this.jsonResponse(200, {
      status: 'ready',
      activeRequests: this.activeRequests,
      totalRequests: this.requestCount,
    }, requestId)
  }

  private async parseBody(req: Request, requestId: string): Promise<{ messages: IMessage[]; sessionId?: string } | null> {
    try {
      // Check content-length before reading
      const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10)
      if (contentLength > MAX_BODY_SIZE) {
        return null
      }
      const text = await req.text()
      if (text.length > MAX_BODY_SIZE) {
        return null
      }
      return JSON.parse(text) as { messages: IMessage[]; sessionId?: string }
    } catch {
      return null
    }
  }

  private prependSystem(messages: IMessage[]): IMessage[] {
    return this.options.systemPrompt
      ? [{ role: 'system', content: this.options.systemPrompt }, ...messages]
      : messages
  }

  private async handleChatSync(req: Request, requestId: string): Promise<Response> {
    const body = await this.parseBody(req, requestId)
    if (!body) return this.jsonResponse(400, { error: 'Invalid JSON' }, requestId)

    const messages = this.prependSystem(body.messages ?? [])

    const loop = new AgentLoop({
      provider: this.options.provider,
      tools: this.options.tools,
      model: this.options.model,
      middleware: this.options.middleware,
      maxIterations: this.options.maxIterations,
      toolTimeout: this.options.toolTimeout,
      sessionId: body.sessionId,
      thinking: this.options.thinking,
      compaction: this.options.compaction,
    })

    try {
      const result = await loop.run(messages)

      // Extract last assistant message text
      const assistantMessages = result.messages.filter(m => m.role === 'assistant')
      const last = assistantMessages[assistantMessages.length - 1]
      const responseText = typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
          : ''

      return this.jsonResponse(200, { response: responseText }, requestId)
    } catch (err) {
      this.log.error('Chat sync error', { requestId, error: err instanceof Error ? err.message : String(err) })
      return this.jsonResponse(500, { error: err instanceof Error ? err.message : String(err) }, requestId)
    }
  }

  private async handleChatStream(req: Request, requestId: string): Promise<Response> {
    const body = await this.parseBody(req, requestId)
    if (!body) return this.jsonResponse(400, { error: 'Invalid JSON' }, requestId)

    const messages = this.prependSystem(body.messages ?? [])
    const opts = this.options
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()

        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        const onStreamChunk = async (ctx: StreamChunkContext) => {
          if (ctx.chunk.type === 'text') {
            send({ type: 'text', delta: ctx.chunk.delta })
          }
        }

        const middleware: Partial<MiddlewareConfig> = {
          ...(opts.middleware ?? {}),
          onStreamChunk: [
            ...(opts.middleware?.onStreamChunk ?? []),
            onStreamChunk,
          ],
        }

        const loop = new AgentLoop({
          provider: opts.provider,
          tools: opts.tools,
          model: opts.model,
          middleware,
          maxIterations: opts.maxIterations,
          toolTimeout: opts.toolTimeout,
          sessionId: body.sessionId,
          thinking: opts.thinking,
          compaction: opts.compaction,
        })

        try {
          await loop.run(messages)
          send({ type: 'done' })
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : String(err) })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Request-ID': requestId,
      },
    })
  }

  private async handleSessions(requestId: string): Promise<Response> {
    const sessions = await this.options.storage.list()
    return this.jsonResponse(200, { sessions }, requestId)
  }
}
