import {
  AgentLoop,
  extractTextContent,
  errorMessage,
  type IMessage,
  type StreamChunkContext,
} from '@chinmaymk/ra'
import type { SessionStorage } from '../storage/sessions'
import { buildMessagePrefix, buildThreadMessages, buildLoopOptions, createSessionLoop, type BaseLoopOptions } from './messages'
import type { AppContext } from '../bootstrap'
import { timingSafeEqual } from 'crypto'

/** Fanout listener for SSE streaming. One per in-flight request. */
type StreamListener = (chunk: StreamChunkContext['chunk']) => void

interface CachedLoop {
  loop: AgentLoop
  listeners: Set<StreamListener>
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA) // constant-time regardless of length mismatch
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export interface HttpOptions extends BaseLoopOptions {
  port: number
  token?: string
  storage: SessionStorage
  /** AppContext reference for hot-reloading config between requests. */
  appContext?: AppContext
}

export class HttpServer {
  private options: HttpOptions
  private server: ReturnType<typeof Bun.serve> | null = null
  /**
   * One AgentLoop per sessionId, sticky for the session's lifetime.
   *
   * Each cache entry owns a Set of SSE stream listeners — the loop's
   * onStreamChunk middleware fans out to whoever is currently listening.
   * This lets us pay the `createSessionLoop` cost (observability handles,
   * compaction middleware, history middleware state) exactly once per
   * session while still letting per-request SSE streams subscribe/unsub.
   */
  private loops = new Map<string, CachedLoop>()

  constructor(options: HttpOptions) {
    this.options = options
  }

  get port(): number { return (this.server?.port ?? this.options.port) as number }

  async start(): Promise<void> {
    const opts = this.options

    this.server = Bun.serve({
      port: opts.port,
      fetch: async (req: Request): Promise<Response> => {
        const url = new URL(req.url)

        // Auth check
        if (opts.token) {
          const authHeader = req.headers.get('Authorization') ?? ''
          const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
          if (!timingSafeCompare(provided, opts.token)) {
            return jsonResponse({ error: 'Unauthorized' }, 401)
          }
        }

        if (req.method === 'POST' && url.pathname === '/chat/sync') {
          return this.handleChatSync(req)
        }

        if (req.method === 'POST' && url.pathname === '/chat') {
          return this.handleChatStream(req)
        }

        if (req.method === 'GET' && url.pathname === '/sessions') {
          return this.handleSessions()
        }

        return jsonResponse({ error: 'Not Found' }, 404)
      },
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop(true)
      this.server = null
    }
  }

  private async parseBody(req: Request): Promise<{ messages: IMessage[]; sessionId?: string } | null> {
    try {
      const body = await req.json() as Record<string, unknown>
      if (!body || typeof body !== 'object') return null
      const messages = Array.isArray(body.messages) ? body.messages as IMessage[] : []
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      return { messages, sessionId }
    } catch {
      return null
    }
  }

  private static badRequest(): Response {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  /**
   * Build the full message array for a loop invocation.
   *
   * New sessions: buildThreadMessages returns the prefix with priorCount=0.
   * Existing sessions: loads stored thread, appends only unseen client messages.
   */
  private async buildMessages(
    clientMessages: IMessage[],
    sessionId: string,
    isNew: boolean,
  ): Promise<{ messages: IMessage[]; priorCount: number }> {
    if (isNew) {
      const { messages, priorCount } = buildThreadMessages({
        storedMessages: [],
        systemPrompt: this.options.systemPrompt,
        skillIndex: this.options.skillIndex,
        contextMessages: this.options.contextMessages,
      })
      messages.push(...clientMessages)
      return { messages, priorCount }
    }

    // Existing session — prefix is already on disk.
    const stored = await this.options.storage.readMessages(sessionId)
    const prefixLen = buildMessagePrefix({
      systemPrompt: this.options.systemPrompt,
      skillIndex: this.options.skillIndex,
      contextMessages: this.options.contextMessages,
    }).length
    const storedConversationLen = Math.max(0, stored.length - prefixLen)
    const newClientMessages = clientMessages.slice(storedConversationLen)
    stored.push(...newClientMessages)
    return { messages: stored, priorCount: stored.length - newClientMessages.length }
  }

  private async ensureSession(clientSessionId?: string): Promise<{ sessionId: string; isNew: boolean }> {
    if (clientSessionId) {
      const result = await this.options.storage.ensureSession(clientSessionId, {
        provider: this.options.provider.name,
        model: this.options.model,
        interface: 'http',
      })
      return { sessionId: result.id, isNew: result.isNew }
    }
    const session = await this.options.storage.create({
      provider: this.options.provider.name,
      model: this.options.model,
      interface: 'http',
    })
    return { sessionId: session.id, isNew: true }
  }

  /** Check for config changes and refresh options if needed. */
  private async refreshOptions(): Promise<void> {
    const ctx = this.options.appContext
    if (!ctx) return
    const reloaded = await ctx.refreshIfNeeded()
    if (reloaded) {
      const fresh = buildLoopOptions(ctx)
      Object.assign(this.options, fresh)
      // Config changed — drop every cached loop so the next request picks up
      // the new provider/tools/middleware. AgentLoop identity is fixed at
      // construction, so we can only honor hot-reload by rebuilding.
      this.loops.clear()
    }
  }

  /**
   * Lazily build (and cache) the AgentLoop for a session.
   *
   * Both `/chat` and `/chat/sync` share the same cached loop per sessionId.
   * A stable `onStreamChunk` middleware fans out to the entry's listener
   * set — SSE handlers add their listener on connect and remove it in the
   * finally block, so concurrent readers are not a concern within a single
   * request lifecycle.
   */
  private getOrCreateLoop(sessionId: string, priorCount: number, resumed: boolean): CachedLoop {
    const existing = this.loops.get(sessionId)
    if (existing) return existing

    const listeners = new Set<StreamListener>()
    const { loop } = createSessionLoop(this.options, {
      storage: this.options.storage,
      sessionId,
      priorCount,
      resumed,
      extraMiddleware: {
        onStreamChunk: [
          async (ctx: StreamChunkContext) => {
            for (const fn of listeners) fn(ctx.chunk)
          },
        ],
      },
    })
    const entry: CachedLoop = { loop, listeners }
    this.loops.set(sessionId, entry)
    return entry
  }

  private async handleChatSync(req: Request): Promise<Response> {
    await this.refreshOptions()

    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const { sessionId, isNew } = await this.ensureSession(body.sessionId)
    const { messages, priorCount } = await this.buildMessages(body.messages ?? [], sessionId, isNew)
    const { loop } = this.getOrCreateLoop(sessionId, priorCount, !isNew)

    try {
      const result = await loop.run(messages)

      const assistantMessages = result.messages.filter(m => m.role === 'assistant')
      const last = assistantMessages[assistantMessages.length - 1]
      const responseText = last ? extractTextContent(last.content) : ''

      return jsonResponse({ response: responseText, sessionId })
    } catch (err) {
      return jsonResponse({ error: errorMessage(err) }, 500)
    }
  }

  private async handleChatStream(req: Request): Promise<Response> {
    await this.refreshOptions()

    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const { sessionId, isNew } = await this.ensureSession(body.sessionId)
    const { messages, priorCount } = await this.buildMessages(body.messages ?? [], sessionId, isNew)
    const entry = this.getOrCreateLoop(sessionId, priorCount, !isNew)

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        // Subscribe this request to the cached loop's stream fanout.
        // Removed in the finally so the listener set doesn't leak.
        const listener: StreamListener = (chunk) => {
          if (chunk.type === 'text') {
            send({ type: 'text', delta: chunk.delta })
          } else if (chunk.type === 'tool_call_start') {
            send({ type: 'tool_call_start', id: chunk.id, name: chunk.name })
          } else if (chunk.type === 'tool_call_delta') {
            send({ type: 'tool_call_delta', id: chunk.id, argsDelta: chunk.argsDelta })
          } else if (chunk.type === 'tool_call_end') {
            send({ type: 'tool_call_end', id: chunk.id })
          }
        }
        entry.listeners.add(listener)

        try {
          await entry.loop.run(messages)
          send({ type: 'done', sessionId })
        } catch (err) {
          send({ type: 'error', error: errorMessage(err) })
        } finally {
          entry.listeners.delete(listener)
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  }

  private async handleSessions(): Promise<Response> {
    const sessions = await this.options.storage.list()
    return jsonResponse({ sessions })
  }
}
