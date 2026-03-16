import type { IProvider, IMessage } from '../providers/types'
import type { MiddlewareConfig, StreamChunkContext } from '../agent/types'
import type { ToolRegistry } from '../agent/tool-registry'
import type { SessionStorage } from '../storage/sessions'
import type { Skill } from '../skills/types'
import type { CompactionConfig } from '../agent/context-compaction'
import { AgentLoop } from '../agent/loop'
import { extractTextContent } from '../providers/utils'
import { buildAvailableSkillsXml } from '../skills/loader'
import { askUserTool } from '../tools/ask-user'
import { errorMessage } from '../utils/errors'
import type { MultiAgentContext } from '../multi-agent'

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
  /** Multi-agent context — when set, requests can specify an `agent` field to route to a specific agent. */
  agents?: MultiAgentContext
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

  private async parseBody(req: Request): Promise<{ messages: IMessage[]; sessionId?: string; agent?: string } | null> {
    try {
      const body = await req.json() as Record<string, unknown>
      if (!body || typeof body !== 'object') return null
      const messages = Array.isArray(body.messages) ? body.messages as IMessage[] : []
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      const agent = typeof body.agent === 'string' ? body.agent : undefined
      return { messages, sessionId, agent }
    } catch {
      return null
    }
  }

  private static badRequest(msg = 'Invalid JSON'): Response {
    return jsonResponse({ error: msg }, 400)
  }

  /** Resolve which options to use — routes to agent context in multi-agent mode. */
  private resolveOptions(agentName?: string): HttpOptions | null {
    if (!agentName || !this.options.agents) return this.options
    const app = this.options.agents.agents.get(agentName)
    if (!app) return null
    return {
      port: this.options.port,
      token: this.options.token,
      model: app.config.model,
      provider: app.provider,
      tools: app.tools,
      storage: app.storage,
      systemPrompt: app.config.systemPrompt,
      skillMap: app.skillMap,
      maxIterations: app.config.maxIterations,
      toolTimeout: app.config.toolTimeout,
      middleware: app.middleware,
      thinking: app.config.thinking,
      compaction: app.config.compaction,
      contextMessages: app.contextMessages,
    }
  }

  private prependSystemWith(opts: HttpOptions, messages: IMessage[]): IMessage[] {
    const prefix: IMessage[] = []
    if (opts.systemPrompt) {
      prefix.push({ role: 'system', content: opts.systemPrompt })
    }
    if (opts.skillMap && opts.skillMap.size > 0) {
      const xml = buildAvailableSkillsXml(opts.skillMap)
      if (xml) prefix.push({ role: 'user', content: xml })
    }
    if (opts.contextMessages?.length) {
      prefix.push(...opts.contextMessages)
    }
    prefix.push(...messages)
    return prefix
  }

  private async handleChatSync(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const resolved = this.resolveOptions(body.agent)
    if (!resolved) return HttpServer.badRequest(`Unknown agent: ${body.agent}`)
    const opts = resolved

    const messages = this.prependSystemWith(opts, body.messages ?? [])

    const loop = new AgentLoop({
      provider: opts.provider,
      tools: opts.tools,
      model: opts.model,
      middleware: opts.middleware,
      maxIterations: opts.maxIterations,
      toolTimeout: opts.toolTimeout,
      sessionId: body.sessionId,
      thinking: opts.thinking,
      compaction: opts.compaction,
    })

    try {
      const result = await loop.run(messages)

      const assistantMessages = result.messages.filter(m => m.role === 'assistant')
      const last = assistantMessages[assistantMessages.length - 1]
      const responseText = last ? extractTextContent(last.content) : ''

      return jsonResponse({ response: responseText })
    } catch (err) {
      return jsonResponse({ error: errorMessage(err) }, 500)
    }
  }

  private async handleChatStream(req: Request): Promise<Response> {
    const body = await this.parseBody(req)
    if (!body) return HttpServer.badRequest()

    const resolved = this.resolveOptions(body.agent)
    if (!resolved) return HttpServer.badRequest(`Unknown agent: ${body.agent}`)
    const opts = resolved
    const messages = this.prependSystemWith(opts, body.messages ?? [])
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

        const middleware: Partial<MiddlewareConfig> = {
          ...(opts.middleware ?? {}),
          onStreamChunk: (opts.middleware?.onStreamChunk ?? []).concat(onStreamChunk),
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
