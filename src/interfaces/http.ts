import type { IProvider, IMessage } from '../providers/types'
import type { MiddlewareConfig, StreamChunkContext } from '../agent/types'
import type { ToolRegistry } from '../agent/tool-registry'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import type { CompactionConfig } from '../agent/context-compaction'
import { AgentLoop } from '../agent/loop'
import { AgentPool, type AgentOverrides } from '../agent/pool'
import { buildAvailableSkillsXml } from '../skills/loader'
import { ASK_USER_SIGNAL } from '../tools/ask-user'

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

export class HttpServer {
  private options: HttpOptions
  private server: ReturnType<typeof Bun.serve> | null = null
  readonly pool: AgentPool

  constructor(options: HttpOptions) {
    this.options = options
    this.pool = new AgentPool({
      provider: options.provider,
      tools: options.tools,
      model: options.model,
      middleware: options.middleware,
      maxIterations: options.maxIterations,
      toolTimeout: options.toolTimeout,
      thinking: options.thinking,
      compaction: options.compaction,
      systemPrompt: options.systemPrompt,
      contextMessages: options.contextMessages,
    })
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

        // ── Agent pool routes ──────────────────────────────────────
        if (url.pathname === '/agents' && req.method === 'GET') {
          return this.handleAgentList()
        }

        if (url.pathname === '/agents' && req.method === 'POST') {
          return this.handleAgentCreate(req)
        }

        const agentMatch = url.pathname.match(/^\/agents\/([^/]+)$/)
        if (agentMatch) {
          const name = decodeURIComponent(agentMatch[1]!)
          if (req.method === 'GET') return this.handleAgentGet(name)
          if (req.method === 'DELETE') return this.handleAgentDelete(name)
        }

        const chatMatch = url.pathname.match(/^\/agents\/([^/]+)\/chat$/)
        if (chatMatch && req.method === 'POST') {
          return this.handleAgentChat(decodeURIComponent(chatMatch[1]!), req)
        }

        const stopMatch = url.pathname.match(/^\/agents\/([^/]+)\/stop$/)
        if (stopMatch && req.method === 'POST') {
          return this.handleAgentStop(decodeURIComponent(stopMatch[1]!))
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
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
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
    return [...prefix, ...messages]
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

      let askQuestion: string | undefined
      for (let i = result.messages.length - 1; i >= 0; i--) {
        const m = result.messages[i]!
        if (m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL)) {
          askQuestion = m.content.slice(ASK_USER_SIGNAL.length)
          break
        }
      }

      return new Response(JSON.stringify({
        response: responseText,
        ...(askQuestion && { askUser: askQuestion, sessionId: body.sessionId }),
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
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
          const result = await loop.run(messages)

          for (let i = result.messages.length - 1; i >= 0; i--) {
            const m = result.messages[i]!
            if (m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith(ASK_USER_SIGNAL)) {
              send({ type: 'ask_user', question: m.content.slice(ASK_USER_SIGNAL.length) })
              break
            }
          }

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
      },
    })
  }

  private async handleSessions(): Promise<Response> {
    const sessions = await this.options.storage.list()
    return new Response(JSON.stringify({ sessions }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Agent pool handlers ──────────────────────────────────────────

  private handleAgentList(): Response {
    return Response.json({ agents: this.pool.list() })
  }

  private async handleAgentCreate(req: Request): Promise<Response> {
    try {
      const body = await req.json() as Record<string, unknown>
      const name = typeof body.name === 'string' ? body.name : ''
      if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
      const overrides: AgentOverrides = {}
      if (typeof body.model === 'string') overrides.model = body.model
      if (typeof body.systemPrompt === 'string') overrides.systemPrompt = body.systemPrompt
      if (typeof body.maxIterations === 'number') overrides.maxIterations = body.maxIterations
      if (body.thinking === 'low' || body.thinking === 'medium' || body.thinking === 'high') overrides.thinking = body.thinking
      const info = this.pool.create(name, overrides)
      return Response.json({ agent: info }, { status: 201 })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const status = msg.includes('already exists') ? 409 : 400
      return Response.json({ error: msg }, { status })
    }
  }

  private handleAgentGet(name: string): Response {
    const info = this.pool.get(name)
    if (!info) return Response.json({ error: `Agent '${name}' not found` }, { status: 404 })
    return Response.json({ agent: info })
  }

  private handleAgentDelete(name: string): Response {
    try {
      this.pool.remove(name)
      return Response.json({ ok: true })
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 })
    }
  }

  private async handleAgentChat(name: string, req: Request): Promise<Response> {
    try {
      const body = await req.json() as Record<string, unknown>
      const messages = Array.isArray(body.messages) ? body.messages as IMessage[] : []
      if (!messages.length) {
        // Convenience: accept { message: "text" } as shorthand
        const text = typeof body.message === 'string' ? body.message : ''
        if (text) messages.push({ role: 'user', content: text })
      }
      if (!messages.length) return Response.json({ error: 'messages or message is required' }, { status: 400 })

      const result = await this.pool.chat(name, messages)
      const assistantMessages = result.messages.filter(m => m.role === 'assistant')
      const last = assistantMessages[assistantMessages.length - 1]
      const responseText = typeof last?.content === 'string'
        ? last.content
        : Array.isArray(last?.content)
          ? last.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
          : ''

      return Response.json({
        response: responseText,
        messages: result.messages,
        iterations: result.iterations,
        usage: result.usage,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const status = msg.includes('not found') ? 404 : msg.includes('already running') ? 409 : 500
      return Response.json({ error: msg }, { status })
    }
  }

  private handleAgentStop(name: string): Response {
    try {
      this.pool.stop(name)
      return Response.json({ ok: true })
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 404 })
    }
  }
}
