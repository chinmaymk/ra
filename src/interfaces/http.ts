import type { IProvider, IMessage } from '../providers/types'
import type { MiddlewareConfig, StreamChunkContext } from '../agent/types'
import type { ToolRegistry } from '../agent/tool-registry'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import type { CompactionConfig } from '../agent/context-compaction'
import type { Logger } from '../observability/logger'
import type { ObservabilityConfig } from '../observability'
import { mkdir } from 'node:fs/promises'
import { AgentLoop } from '../agent/loop'
import { createSessionMiddleware } from '../agent/session'
import { extractTextContent } from '../providers/utils'
import { buildAvailableSkillsXml } from '../skills/loader'
import { askUserTool } from '../tools/ask-user'
import { errorMessage } from '../utils/errors'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

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
  contextMessages?: IMessage[]
  logger?: Logger
  obsConfig?: ObservabilityConfig
}

export class HttpServer {
  private options: HttpOptions
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(options: HttpOptions) {
    this.options = options
    options.tools.register(askUserTool())
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
          if (provided !== opts.token) {
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

  private prependSystem(messages: IMessage[]): IMessage[] {
    const prefix: IMessage[] = []
    if (this.options.systemPrompt) {
      prefix.push({ role: 'system', content: this.options.systemPrompt })
    }
    if (this.options.skillMap && this.options.skillMap.size > 0) {
      const xml = buildAvailableSkillsXml(this.options.skillMap)
      if (xml) prefix.push({ role: 'user', content: xml })
    }
    if (this.options.contextMessages?.length) {
      prefix.push(...this.options.contextMessages)
    }
    prefix.push(...messages)
    return prefix
  }

  private async ensureSession(clientSessionId?: string): Promise<string> {
    if (clientSessionId) {
      // Ensure session directory exists for client-provided IDs
      await mkdir(this.options.storage.sessionDir(clientSessionId), { recursive: true })
      return clientSessionId
    }
    const session = await this.options.storage.create({
      provider: this.options.provider.name,
      model: this.options.model,
      interface: 'http',
    })
    return session.id
  }

  private async handleChatSync(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const messages = this.prependSystem(body.messages ?? [])
    const sessionId = await this.ensureSession(body.sessionId)

    // Persist incoming user messages before starting the loop
    const userMessages = (body.messages ?? []).filter((m: IMessage) => m.role === 'user')
    await this.options.storage.appendMessages(sessionId, userMessages)

    const session = createSessionMiddleware(this.options.middleware, {
      storage: this.options.storage,
      sessionId,
      obsConfig: this.options.obsConfig,
      logger: this.options.logger,
    })
    const loop = new AgentLoop({
      provider: this.options.provider,
      tools: this.options.tools,
      model: this.options.model,
      middleware: session.middleware,
      maxIterations: this.options.maxIterations,
      toolTimeout: this.options.toolTimeout,
      sessionId,
      thinking: this.options.thinking,
      compaction: this.options.compaction,
      logger: session.logger,
    })

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

    const messages = this.prependSystem(body.messages ?? [])
    const sessionId = await this.ensureSession(body.sessionId)

    // Persist incoming user messages before starting the loop
    const userMessages = (body.messages ?? []).filter((m: IMessage) => m.role === 'user')
    await this.options.storage.appendMessages(sessionId, userMessages)

    const opts = this.options
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

        const session = createSessionMiddleware(opts.middleware, {
          storage: opts.storage,
          sessionId,
          obsConfig: opts.obsConfig,
          logger: opts.logger,
        })
        const middleware: MiddlewareConfig = {
          ...session.middleware,
          onStreamChunk: session.middleware.onStreamChunk.concat(onStreamChunk),
        }

        const loop = new AgentLoop({
          provider: opts.provider,
          tools: opts.tools,
          model: opts.model,
          middleware,
          maxIterations: opts.maxIterations,
          toolTimeout: opts.toolTimeout,
          sessionId,
          thinking: opts.thinking,
          compaction: opts.compaction,
          logger: session.logger,
        })

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
