import type { OrchestratorContext } from './types'
import type { IMessage } from '../providers/types'
import type { StreamChunkContext, MiddlewareConfig } from '../agent/types'
import { AgentLoop } from '../agent/loop'
import { Repl } from '../interfaces/repl'
import { runCli } from '../interfaces/cli'
import { parseRoute, isRouteError } from './router'
import type { AppContext } from '../bootstrap'
import { buildAvailableSkillsXml } from '../skills/loader'
import { ASK_USER_SIGNAL } from '../tools/ask-user'

// ── Shared ──────────────────────────────────────────────────────────

function appContextToReplOptions(app: AppContext) {
  return {
    model: app.config.model,
    provider: app.provider,
    tools: app.tools,
    storage: app.storage,
    systemPrompt: app.config.systemPrompt,
    skillMap: app.skillMap,
    middleware: app.middleware,
    maxIterations: app.config.maxIterations,
    toolTimeout: app.config.toolTimeout,
    sessionId: app.sessionId,
    thinking: app.config.thinking,
    compaction: app.config.compaction,
    contextMessages: app.contextMessages,
    memoryStore: app.memoryStore,
  }
}

// ── CLI ──────────────────────────────────────────────────────────────

export async function launchOrchestratorCli(
  orchCtx: OrchestratorContext,
  prompt: string,
): Promise<void> {
  const agentNames = [...orchCtx.agents.keys()]
  const route = parseRoute(prompt, agentNames, orchCtx.defaultAgent)

  if (isRouteError(route)) {
    console.error(`Error: ${route.error}`)
    process.exit(1)
    return // unreachable, helps TS narrow
  }

  const app = orchCtx.agents.get(route.agentName)!

  const result = await runCli({
    prompt: route.message,
    systemPrompt: app.config.systemPrompt,
    model: app.config.model,
    provider: app.provider,
    tools: app.tools,
    skillMap: app.skillMap,
    maxIterations: app.config.maxIterations,
    middleware: app.middleware,
    thinking: app.config.thinking,
    compaction: app.config.compaction,
    contextMessages: app.contextMessages,
  })

  for (const msg of result.messages.slice(result.priorCount)) {
    await app.storage.appendMessage(app.sessionId, msg)
  }

  process.stdout.write('\n')
  await orchCtx.shutdown()
}

// ── REPL ─────────────────────────────────────────────────────────────

export async function launchOrchestratorRepl(
  orchCtx: OrchestratorContext,
): Promise<void> {
  const defaultName = orchCtx.defaultAgent ?? orchCtx.agents.keys().next().value!
  const repl = new OrchestratorRepl(orchCtx, defaultName)
  await repl.start()
  await orchCtx.shutdown()
}

class OrchestratorRepl extends Repl {
  private orchCtx: OrchestratorContext
  private currentAgentName: string

  constructor(orchCtx: OrchestratorContext, defaultAgentName: string) {
    const app = orchCtx.agents.get(defaultAgentName)!
    super(appContextToReplOptions(app))
    this.orchCtx = orchCtx
    this.currentAgentName = defaultAgentName
  }

  override async processInput(input: string): Promise<void> {
    const agentNames = [...this.orchCtx.agents.keys()]
    const route = parseRoute(input, agentNames, this.orchCtx.defaultAgent)

    if (isRouteError(route)) {
      const { printError } = await import('../interfaces/tui')
      printError(route.error)
      return
    }

    // If routing to a different agent, swap the underlying options
    if (route.agentName !== this.currentAgentName) {
      const app = this.orchCtx.agents.get(route.agentName)!
      this.swapAgent(app, route.agentName)
    }

    // Delegate to Repl.processInput with the cleaned message
    await super.processInput(route.message)
  }

  private swapAgent(app: AppContext, name: string): void {
    this.options = appContextToReplOptions(app)
    this.currentAgentName = name
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────

export async function launchOrchestratorHttp(
  orchCtx: OrchestratorContext,
  port: number,
  token?: string,
): Promise<void> {
  const defaultName = orchCtx.defaultAgent ?? orchCtx.agents.keys().next().value!

  function getAgent(name: string): AppContext | undefined {
    return orchCtx.agents.get(name)
  }

  function checkAuth(req: Request): Response | null {
    if (!token) return null
    const authHeader = req.headers.get('Authorization') ?? ''
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (provided !== token) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return null
  }

  function prependSystem(app: AppContext, messages: IMessage[]): IMessage[] {
    const prefix: IMessage[] = []
    if (app.config.systemPrompt) {
      prefix.push({ role: 'system', content: app.config.systemPrompt })
    }
    if (app.skillMap && app.skillMap.size > 0) {
      const xml = buildAvailableSkillsXml(app.skillMap)
      if (xml) prefix.push({ role: 'user', content: xml })
    }
    if (app.contextMessages?.length) {
      prefix.push(...app.contextMessages)
    }
    return [...prefix, ...messages]
  }

  async function parseBody(req: Request): Promise<{ messages: IMessage[]; sessionId?: string } | null> {
    try {
      const body = await req.json() as Record<string, unknown>
      if (!body || typeof body !== 'object') return null
      const messages = Array.isArray(body.messages) ? body.messages as IMessage[] : []
      if (!messages.length && typeof body.message === 'string' && body.message) {
        messages.push({ role: 'user', content: body.message })
      }
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
      return { messages, sessionId }
    } catch {
      return null
    }
  }

  async function handleChatSync(app: AppContext, req: Request): Promise<Response> {
    const body = await parseBody(req)
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

    const messages = prependSystem(app, body.messages)
    const loop = new AgentLoop({
      provider: app.provider,
      tools: app.tools,
      model: app.config.model,
      middleware: app.middleware,
      maxIterations: app.config.maxIterations,
      toolTimeout: app.config.toolTimeout,
      sessionId: body.sessionId,
      thinking: app.config.thinking,
      compaction: app.config.compaction,
    })

    try {
      const result = await loop.run(messages)
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

      return Response.json({
        response: responseText,
        ...(askQuestion ? { askUser: askQuestion, sessionId: body.sessionId } : {}),
      })
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  }

  async function handleChatStream(app: AppContext, req: Request): Promise<Response> {
    const body = await parseBody(req)
    if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

    const messages = prependSystem(app, body.messages)
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder()
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        }

        const onStreamChunk = async (ctx: StreamChunkContext) => {
          if (ctx.chunk.type === 'text') send({ type: 'text', delta: ctx.chunk.delta })
        }

        const middleware: Partial<MiddlewareConfig> = {
          ...(app.middleware ?? {}),
          onStreamChunk: [
            ...(app.middleware?.onStreamChunk ?? []),
            onStreamChunk,
          ],
        }

        const loop = new AgentLoop({
          provider: app.provider,
          tools: app.tools,
          model: app.config.model,
          middleware,
          maxIterations: app.config.maxIterations,
          toolTimeout: app.config.toolTimeout,
          sessionId: body.sessionId,
          thinking: app.config.thinking,
          compaction: app.config.compaction,
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

  Bun.serve({
    port,
    fetch: async (req: Request): Promise<Response> => {
      const authErr = checkAuth(req)
      if (authErr) return authErr

      const url = new URL(req.url)

      if (req.method !== 'POST') {
        // GET /agents — list available agents
        if (req.method === 'GET' && url.pathname === '/agents') {
          const agents = [...orchCtx.agents.keys()].map(name => ({
            name,
            default: name === defaultName,
          }))
          return Response.json({ agents })
        }
        return Response.json({ error: 'Not Found' }, { status: 404 })
      }

      // POST /chat/sync — default agent, sync response
      if (url.pathname === '/chat/sync') {
        return handleChatSync(orchCtx.agents.get(defaultName)!, req)
      }
      // POST /chat — default agent, SSE stream
      if (url.pathname === '/chat') {
        return handleChatStream(orchCtx.agents.get(defaultName)!, req)
      }

      // POST /agents/{name}/chat/sync — named agent, sync response
      const syncMatch = url.pathname.match(/^\/agents\/([^/]+)\/chat\/sync$/)
      if (syncMatch) {
        const name = decodeURIComponent(syncMatch[1]!)
        const app = getAgent(name)
        if (!app) return Response.json({ error: `Agent '${name}' not found` }, { status: 404 })
        return handleChatSync(app, req)
      }

      // POST /agents/{name}/chat — named agent, SSE stream
      const chatMatch = url.pathname.match(/^\/agents\/([^/]+)\/chat$/)
      if (chatMatch) {
        const name = decodeURIComponent(chatMatch[1]!)
        const app = getAgent(name)
        if (!app) return Response.json({ error: `Agent '${name}' not found` }, { status: 404 })
        return handleChatStream(app, req)
      }

      return Response.json({ error: 'Not Found' }, { status: 404 })
    },
  })

  console.error(`HTTP server listening on port ${port}`)
  console.error(`Agents: ${[...orchCtx.agents.keys()].join(', ')} (default: ${defaultName})`)
  await new Promise(() => {}) // keep alive
}
