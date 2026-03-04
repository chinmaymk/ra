import type { IProvider, IMessage } from '../providers/types'
import type { MiddlewareConfig, StreamChunkContext } from '../agent/types'
import type { ToolRegistry } from '../agent/tool-registry'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import type { CompactionConfig } from '../agent/context-compaction'
import { AgentLoop } from '../agent/loop'

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
  thinking?: 'low' | 'medium' | 'high'
  compaction?: CompactionConfig
}

export class HttpServer {
  private options: HttpOptions
  private server: ReturnType<typeof Bun.serve> | null = null

  constructor(options: HttpOptions) {
    this.options = options
  }

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
            return new Response(JSON.stringify({ error: 'Unauthorized' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            })
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

        return new Response(JSON.stringify({ error: 'Not Found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
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
      return await req.json() as { messages: IMessage[]; sessionId?: string }
    } catch {
      return null
    }
  }

  private static badRequest(): Response {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private prependSystem(messages: IMessage[]): IMessage[] {
    return this.options.systemPrompt
      ? [{ role: 'system', content: this.options.systemPrompt }, ...messages]
      : messages
  }

  private async handleChatSync(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const messages = this.prependSystem(body.messages ?? [])

    const loop = new AgentLoop({
      provider: this.options.provider,
      tools: this.options.tools,
      model: this.options.model,
      middleware: this.options.middleware,
      maxIterations: this.options.maxIterations,
      sessionId: body.sessionId,
      thinking: this.options.thinking,
      compaction: this.options.compaction,
    })

    const result = await loop.run(messages)

    // Extract last assistant message text
    const assistantMessages = result.messages.filter(m => m.role === 'assistant')
    const last = assistantMessages[assistantMessages.length - 1]
    const responseText = typeof last?.content === 'string' ? last.content : ''

    return new Response(JSON.stringify({ response: responseText }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async handleChatStream(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

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
          sessionId: body.sessionId,
          thinking: opts.thinking,
          compaction: opts.compaction,
        })

        try {
          await loop.run(messages)
        } finally {
          send({ type: 'done' })
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
    return new Response(JSON.stringify({ sessions }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
