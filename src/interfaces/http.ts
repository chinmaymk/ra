import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
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
  private server: Server | null = null

  constructor(options: HttpOptions) {
    this.options = options
    options.tools.register(askUserTool())
  }

  get port(): number {
    const addr = this.server?.address()
    if (addr && typeof addr === 'object') return addr.port
    return this.options.port
  }

  async start(): Promise<void> {
    const opts = this.options

    this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const addr = this.server?.address()
      const actualPort = (addr && typeof addr === 'object') ? addr.port : opts.port
      const url = new URL(req.url ?? '/', `http://localhost:${actualPort}`)

      // Auth check
      if (opts.token) {
        const authHeader = req.headers['authorization'] ?? ''
        const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
        if (provided !== opts.token) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Unauthorized' }))
          return
        }
      }

      if (req.method === 'POST' && url.pathname === '/chat/sync') {
        const body = await this.parseNodeBody(req)
        if (!body) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid JSON' })); return }
        const response = await this.handleChatSyncNode(body)
        res.writeHead(response.status, { 'Content-Type': 'application/json' })
        res.end(response.body)
        return
      }

      if (req.method === 'POST' && url.pathname === '/chat') {
        const body = await this.parseNodeBody(req)
        if (!body) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid JSON' })); return }
        await this.handleChatStreamNode(body, res)
        return
      }

      if (req.method === 'GET' && url.pathname === '/sessions') {
        const sessions = await this.options.storage.list()
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ sessions }))
        return
      }

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
    })

    await new Promise<void>((resolve) => {
      this.server!.listen(opts.port, () => resolve())
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.server = null
    }
  }

  private parseNodeBody(req: IncomingMessage): Promise<{ messages: IMessage[]; sessionId?: string } | null> {
    return new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk: Buffer) => { data += chunk.toString() })
      req.on('end', () => {
        try {
          const body = JSON.parse(data) as Record<string, unknown>
          if (!body || typeof body !== 'object') { resolve(null); return }
          const messages = Array.isArray(body.messages) ? body.messages as IMessage[] : []
          const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
          resolve({ messages, sessionId })
        } catch {
          resolve(null)
        }
      })
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
    prefix.push(...messages)
    return prefix
  }

  private async handleChatSyncNode(body: { messages: IMessage[]; sessionId?: string }): Promise<{ status: number; body: string }> {
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
      const assistantMessages = result.messages.filter(m => m.role === 'assistant')
      const last = assistantMessages[assistantMessages.length - 1]
      const responseText = last ? extractTextContent(last.content) : ''
      return { status: 200, body: JSON.stringify({ response: responseText }) }
    } catch (err) {
      return { status: 500, body: JSON.stringify({ error: errorMessage(err) }) }
    }
  }

  private async handleChatStreamNode(body: { messages: IMessage[]; sessionId?: string }, res: ServerResponse): Promise<void> {
    const messages = this.prependSystem(body.messages ?? [])
    const opts = this.options

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
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
      res.end()
    }
  }
}
