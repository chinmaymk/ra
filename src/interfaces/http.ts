import type { IProvider, IMessage } from '../providers/types'
import { contentToString } from '../providers/utils'
import type { MiddlewareConfig, StreamChunkContext } from '../agent/types'
import type { ToolRegistry } from '../agent/tool-registry'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import type { CompactionConfig } from '../agent/context-compaction'
import { AgentLoop } from '../agent/loop'
import { buildAvailableSkillsXml } from '../skills/loader'
import { extractAskUserQuestion } from '../tools/ask-user'

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
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
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

        if (opts.token) {
          const authHeader = req.headers.get('Authorization') ?? ''
          const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
          if (provided !== opts.token) return jsonResponse({ error: 'Unauthorized' }, 401)
        }

        if (req.method === 'POST' && url.pathname === '/chat/sync') return this.handleChatSync(req)
        if (req.method === 'POST' && url.pathname === '/chat') return this.handleChatStream(req)
        if (req.method === 'GET' && url.pathname === '/sessions') return this.handleSessions()

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
      // Ensure messages is an array (default to empty if missing)
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
    if (this.options.systemPrompt) prefix.push({ role: 'system', content: this.options.systemPrompt })
    if (this.options.skillMap && this.options.skillMap.size > 0) {
      const xml = buildAvailableSkillsXml(this.options.skillMap)
      if (xml) prefix.push({ role: 'user', content: xml })
    }
    if (this.options.contextMessages?.length) prefix.push(...this.options.contextMessages)
    return [...prefix, ...messages]
  }

  private createLoop(sessionId?: string, extraMiddleware?: Partial<MiddlewareConfig>): AgentLoop {
    const o = this.options
    return new AgentLoop({
      provider: o.provider, tools: o.tools, model: o.model,
      maxIterations: o.maxIterations, toolTimeout: o.toolTimeout,
      thinking: o.thinking, compaction: o.compaction, sessionId,
      middleware: extraMiddleware ?? o.middleware,
    })
  }

  private async handleChatSync(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    try {
      const result = await this.createLoop(body.sessionId).run(this.prependSystem(body.messages ?? []))
      const last = result.messages.filter(m => m.role === 'assistant').at(-1)
      const responseText = last ? contentToString(last.content) : ''
      const askQuestion = extractAskUserQuestion(result.messages)

      return jsonResponse({
        response: responseText,
        ...(askQuestion && { askUser: askQuestion, sessionId: body.sessionId }),
      })
    } catch (err) {
      return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  }

  private async handleChatStream(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const messages = this.prependSystem(body.messages ?? [])
    const opts = this.options
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

        const middleware: Partial<MiddlewareConfig> = {
          ...(opts.middleware ?? {}),
          onStreamChunk: [...(opts.middleware?.onStreamChunk ?? []), async (ctx: StreamChunkContext) => {
            if (ctx.chunk.type === 'text') send({ type: 'text', delta: ctx.chunk.delta })
          }],
        }

        const loop = new AgentLoop({
          provider: opts.provider, tools: opts.tools, model: opts.model, middleware,
          maxIterations: opts.maxIterations, toolTimeout: opts.toolTimeout,
          sessionId: body.sessionId, thinking: opts.thinking, compaction: opts.compaction,
        })

        try {
          const result = await loop.run(messages)
          const askQuestion = extractAskUserQuestion(result.messages)
          if (askQuestion) send({ type: 'ask_user', question: askQuestion })
          send({ type: 'done' })
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : String(err) })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    })
  }

  private async handleSessions(): Promise<Response> {
    return jsonResponse({ sessions: await this.options.storage.list() })
  }
}
