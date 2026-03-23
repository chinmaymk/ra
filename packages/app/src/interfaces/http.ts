import {
  extractTextContent,
  errorMessage,
  type IMessage,
  type MiddlewareConfig,
  type StreamChunkContext,
} from '@chinmaymk/ra'
import type { SessionStorage } from '../storage/sessions'
import { buildMessagePrefix, buildThreadMessages, createSessionLoop, type BaseLoopOptions } from './messages'
import { timingSafeEqual } from 'crypto'

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
}

export class HttpServer {
  private options: HttpOptions
  private server: ReturnType<typeof Bun.serve> | null = null

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

  /** Create a session-scoped AgentLoop. */
  private createLoop(sessionId: string, priorCount: number, extraMiddleware?: Partial<MiddlewareConfig>, resumed = false) {
    return createSessionLoop(this.options, {
      storage: this.options.storage,
      sessionId,
      priorCount,
      resumed,
      extraMiddleware,
    }).loop
  }

  private async handleChatSync(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const { sessionId, isNew } = await this.ensureSession(body.sessionId)
    const { messages, priorCount } = await this.buildMessages(body.messages ?? [], sessionId, isNew)
    const loop = this.createLoop(sessionId, priorCount, undefined, !isNew)

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
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const { sessionId, isNew } = await this.ensureSession(body.sessionId)
    const { messages, priorCount } = await this.buildMessages(body.messages ?? [], sessionId, isNew)

    const self = this
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        const onStreamChunk = async (ctx: StreamChunkContext) => {
          const { chunk } = ctx
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

        const loop = self.createLoop(sessionId, priorCount, { onStreamChunk: [onStreamChunk] }, !isNew)

        try {
          await loop.run(messages)
          send({ type: 'done', sessionId })
        } catch (err) {
          send({ type: 'error', error: errorMessage(err) })
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
      },
    })
  }

  private async handleSessions(): Promise<Response> {
    const sessions = await this.options.storage.list()
    return jsonResponse({ sessions })
  }
}
