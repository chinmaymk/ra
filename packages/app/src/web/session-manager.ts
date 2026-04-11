import {
  type AgentLoop,
  extractTextContent,
  type IMessage,
  type ContentPart,
  type MiddlewareConfig,
  type StreamChunkContext,
  type LoopContext,
  type ToolExecutionContext,
  type ToolResultContext,
  type TokenUsage,
  type ErrorContext,
} from '@chinmaymk/ra'
import type { AppContext } from '../bootstrap'
import { buildMessagePrefix, buildLoopOptions, createSessionLoop } from '../interfaces/messages'
import { WorktreeManager, type Worktree } from './worktree-manager'

// ── Types ────────────────────────────────────────────────────────────

export type SessionStatus = 'idle' | 'running' | 'needs-input' | 'error' | 'done'

export interface SessionEvent {
  type: string
  [key: string]: unknown
}

export interface ManagedSession {
  id: string
  name: string
  status: SessionStatus
  provider: string
  model: string
  createdAt: string
  worktree?: Worktree
  iteration: number
  tokenUsage: TokenUsage
  currentTool?: string
  lastAssistantMessage?: string
  errorMessage?: string
  cwd: string
}

interface SessionInternal {
  info: ManagedSession
  /** Active AgentLoop while running, null when idle/done. */
  loop: AgentLoop | null
  messages: IMessage[]
  priorCount: number
  subscribers: Set<(event: SessionEvent) => void>
  /** True once messages have been read from disk (or initialized for new sessions). */
  messagesLoaded: boolean
}

export interface ImageAttachment {
  /** Base64-encoded image data (no data URI prefix) */
  data: string
  /** MIME type (e.g. 'image/png') */
  mimeType: string
  /** Optional filename for display */
  name?: string
}

function buildMultipartContent(text: string, attachments: ImageAttachment[]): ContentPart[] {
  const parts: ContentPart[] = []
  if (text) parts.push({ type: 'text', text })
  for (const att of attachments) {
    parts.push({
      type: 'image',
      source: { type: 'base64', mediaType: att.mimeType, data: att.data },
    })
  }
  return parts
}

// ── Name generation ──────────────────────────────────────────────────

function generateName(message: string): string {
  const cleaned = message
    .replace(/[`'"]/g, '')
    .replace(/\n/g, ' ')
    .trim()
    .toLowerCase()

  // Try to extract verb + object pattern
  const words = cleaned.split(/\s+/).slice(0, 5)
  const name = words.join('-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return name.slice(0, 40) || `session-${Date.now()}`
}

// ── SessionManager ───────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, SessionInternal>()
  private app: AppContext
  private worktreeManager: WorktreeManager

  constructor(app: AppContext) {
    this.app = app
    this.worktreeManager = new WorktreeManager(
      app.config.app.dataDir ?? `${process.env.HOME}/.ra`,
    )
  }

  /**
   * Restore previously persisted web sessions from disk — METADATA ONLY.
   *
   * No messages are read, no loop is built. Restored sessions appear in the
   * session list as 'done' with a placeholder name. The messages.jsonl file
   * is only touched on first interaction (send / getMessages / get) via
   * `ensureMessagesLoaded`. This keeps startup O(N) cheap meta.json reads
   * instead of O(N) full conversation reads.
   */
  async restore(): Promise<void> {
    const stored = await this.app.storage.list()
    const webSessions = stored.filter(s => s.meta.interface === 'web')

    await Promise.all(webSessions.map(async s => {
      if (this.sessions.has(s.id)) return

      // Backfill title for sessions persisted before titles were tracked.
      let title = s.meta.title
      let lastAssistantMessage = s.meta.lastAssistantMessage
      if (!title || !lastAssistantMessage) {
        const { title: t, lastAssistantMessage: l } = await this.extractMetaFromMessages(s.id)
        title = title ?? t
        lastAssistantMessage = lastAssistantMessage ?? l
        if (title || lastAssistantMessage) {
          await this.app.storage.updateMeta(s.id, { title, lastAssistantMessage })
        }
      }

      const info: ManagedSession = {
        id: s.id,
        name: title ?? `session-${s.id.slice(0, 8)}`,
        status: 'done',
        provider: s.meta.provider,
        model: s.meta.model,
        createdAt: s.meta.created,
        iteration: s.meta.iteration ?? 0,
        tokenUsage: s.meta.tokenUsage ?? { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
        lastAssistantMessage,
        cwd: process.cwd(),
      }

      this.sessions.set(s.id, {
        info,
        loop: null,
        messages: [],
        priorCount: 0,
        subscribers: new Set(),
        messagesLoaded: false,
      })
    }))
  }

  /** Extract display title + last assistant preview from persisted messages. */
  private async extractMetaFromMessages(sessionId: string): Promise<{ title?: string; lastAssistantMessage?: string }> {
    let stored: IMessage[]
    try {
      stored = await this.app.storage.readMessages(sessionId)
    } catch {
      return {}
    }
    const firstUser = stored.find(m =>
      m.role === 'user' &&
      typeof m.content === 'string' &&
      !m.content.startsWith('<')
    )
    const title = firstUser && typeof firstUser.content === 'string'
      ? generateName(firstUser.content)
      : undefined
    const lastAssistant = stored.filter(m => m.role === 'assistant').at(-1)
    const lastAssistantMessage = lastAssistant
      ? extractTextContent(lastAssistant.content).slice(0, 200)
      : undefined
    return { title, lastAssistantMessage }
  }

  /**
   * Lazy-load messages for a restored session and refine its display name
   * + last-assistant preview from the loaded thread. No-op if already loaded.
   */
  private async ensureMessagesLoaded(session: SessionInternal): Promise<void> {
    if (session.messagesLoaded) return
    session.messagesLoaded = true // mark first to dedupe concurrent calls

    let stored: IMessage[] = []
    try {
      stored = await this.app.storage.readMessages(session.info.id)
    } catch {
      // Messages file doesn't exist — leave session.messages empty
      return
    }

    session.messages = stored
    session.priorCount = stored.length

    // Refine display name from the first non-context user message
    const firstUser = stored.find(m =>
      m.role === 'user' &&
      typeof m.content === 'string' &&
      !m.content.startsWith('<')
    )
    if (firstUser && typeof firstUser.content === 'string') {
      session.info.name = generateName(firstUser.content)
    }

    // Set last-assistant preview
    const lastAssistant = stored.filter(m => m.role === 'assistant').at(-1)
    if (lastAssistant) {
      session.info.lastAssistantMessage = extractTextContent(lastAssistant.content).slice(0, 200)
    }
  }

  /** Create a new session. Does not start the loop — that happens on first message. */
  async create(
    firstMessage: string,
    options?: { worktree?: boolean; branch?: string; attachments?: ImageAttachment[] }
  ): Promise<ManagedSession> {
    const id = crypto.randomUUID()
    const name = generateName(firstMessage)

    let worktree: Worktree | undefined
    if (options?.worktree) {
      worktree = await this.worktreeManager.create(id, options.branch)
    }

    // Create a persistent session in storage using our chosen ID
    await this.app.storage.ensureSession(id, {
      provider: this.app.provider.name,
      model: this.app.config.agent.model,
      interface: 'web',
    })
    await this.app.storage.updateMeta(id, { title: name })

    const info: ManagedSession = {
      id,
      name,
      status: 'idle',
      provider: this.app.provider.name,
      model: this.app.config.agent.model,
      createdAt: new Date().toISOString(),
      worktree,
      iteration: 0,
      tokenUsage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      cwd: worktree?.path ?? process.cwd(),
    }

    // Build message prefix (system prompt + skills + context)
    const prefix = buildMessagePrefix({
      systemPrompt: this.app.config.agent.systemPrompt,
      skillIndex: this.app.skillIndex,
      contextMessages: this.app.contextMessages,
    })

    const internal: SessionInternal = {
      info,
      loop: null,
      messages: [...prefix],
      priorCount: 0,
      subscribers: new Set(),
      messagesLoaded: true, // newly-created sessions have their prefix in memory
    }

    this.sessions.set(id, internal)

    // Immediately send the first message and start the loop
    this.sendInternal(internal, firstMessage, options?.attachments)

    return info
  }

  /** Send a user message to an existing session. */
  async send(sessionId: string, message: string, attachments?: ImageAttachment[]): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found: ' + sessionId)
    if (session.info.status === 'running') throw new Error('Session is already running')

    // Lazy-load messages from disk for restored sessions before resuming
    await this.ensureMessagesLoaded(session)
    this.sendInternal(session, message, attachments)
  }

  private sendInternal(session: SessionInternal, message: string, attachments?: ImageAttachment[]): void {
    // Build user message content — text only, or multipart if there are images
    const content: string | ContentPart[] = attachments && attachments.length > 0
      ? buildMultipartContent(message, attachments)
      : message
    session.messages.push({ role: 'user', content })
    session.info.status = 'running'
    session.info.currentTool = undefined
    session.info.errorMessage = undefined
    this.broadcast(session, { type: 'status', status: 'running' })

    // Create and run the loop
    this.runLoop(session).catch(err => {
      session.info.status = 'error'
      session.info.errorMessage = err instanceof Error ? err.message : String(err)
      this.broadcast(session, { type: 'error', error: session.info.errorMessage })
      this.broadcast(session, { type: 'status', status: 'error', name: session.info.name })
    })
  }

  /**
   * Lazily build (and cache) the AgentLoop for this session.
   *
   * The loop is sticky: created once on the first user message, reused
   * across every subsequent turn. The history middleware's internal
   * `savedIds` Set lives with the loop and naturally dedupes message
   * persistence across runs — no need to recreate the loop each turn.
   */
  private getOrCreateLoop(session: SessionInternal): AgentLoop {
    if (session.loop) return session.loop

    // Capture current app state (provider, tools, middleware) once when
    // the loop is born. Subsequent hot reloads to the config won't affect
    // sessions that have already started — by design, an agent's identity
    // is fixed for its lifetime.
    const baseOptions = buildLoopOptions(this.app)
    const streamMiddleware = this.buildStreamMiddleware(session)

    const { loop } = createSessionLoop(baseOptions, {
      storage: this.app.storage,
      sessionId: session.info.id,
      priorCount: session.priorCount,
      resumed: session.priorCount > 0,
      extraMiddleware: streamMiddleware,
    })

    session.loop = loop
    return loop
  }

  private async runLoop(session: SessionInternal): Promise<void> {
    const loop = this.getOrCreateLoop(session)
    const result = await loop.run([...session.messages])

    // Update session state from result. The AgentLoop instance stays alive
    // in session.loop for the next turn — only its internal per-run state
    // (iterations counter, abort controller) resets on the next run().
    session.messages = result.messages
    session.priorCount = result.messages.length
    session.info.iteration = result.iterations
    session.info.tokenUsage = result.usage
    session.info.currentTool = undefined

    // Extract last assistant message for preview
    const lastAssistant = result.messages.filter(m => m.role === 'assistant').at(-1)
    if (lastAssistant) {
      session.info.lastAssistantMessage = extractTextContent(lastAssistant.content).slice(0, 200)
    }

    // Determine final status
    if (result.stopReason === 'aborted') {
      session.info.status = 'done'
    } else {
      session.info.status = 'needs-input'
    }

    // Persist title + usage stats so they survive restart
    await this.app.storage.updateMeta(session.info.id, {
      title: session.info.name,
      tokenUsage: session.info.tokenUsage,
      iteration: session.info.iteration,
      lastAssistantMessage: session.info.lastAssistantMessage,
    })

    this.broadcast(session, { type: 'done', stopReason: result.stopReason })
    this.broadcast(session, { type: 'status', status: session.info.status, name: session.info.name })
  }

  private buildStreamMiddleware(session: SessionInternal): Partial<MiddlewareConfig> {
    const onStreamChunk = async (ctx: StreamChunkContext) => {
      const { chunk } = ctx
      if (chunk.type === 'text') {
        this.broadcast(session, { type: 'text', delta: chunk.delta })
      } else if (chunk.type === 'thinking') {
        this.broadcast(session, { type: 'thinking', delta: chunk.delta })
      } else if (chunk.type === 'tool_call_start') {
        this.broadcast(session, { type: 'tool_call_start', id: chunk.id, name: chunk.name })
      } else if (chunk.type === 'tool_call_delta') {
        this.broadcast(session, { type: 'tool_call_delta', id: chunk.id, argsDelta: chunk.argsDelta })
      } else if (chunk.type === 'tool_call_end') {
        this.broadcast(session, { type: 'tool_call_end', id: chunk.id })
      }
    }

    const beforeToolExecution = async (ctx: ToolExecutionContext) => {
      session.info.currentTool = ctx.toolCall.name
      this.broadcast(session, {
        type: 'stats',
        usage: session.info.tokenUsage,
        iteration: session.info.iteration,
        currentTool: ctx.toolCall.name,
      })
    }

    const afterToolExecution = async (ctx: ToolResultContext) => {
      const result = ctx.result
      this.broadcast(session, {
        type: 'tool_result',
        toolCallId: result.toolCallId,
        content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
        isError: result.isError,
      })
      session.info.currentTool = undefined
    }

    const afterLoopIteration = async (ctx: LoopContext) => {
      session.info.iteration = ctx.iteration
      session.info.tokenUsage = ctx.usage
      this.broadcast(session, {
        type: 'stats',
        usage: ctx.usage,
        iteration: ctx.iteration,
      })
    }

    const onError = async (ctx: ErrorContext) => {
      session.info.errorMessage = ctx.error instanceof Error ? ctx.error.message : String(ctx.error)
      this.broadcast(session, { type: 'error', error: session.info.errorMessage })
    }

    return {
      onStreamChunk: [onStreamChunk],
      beforeToolExecution: [beforeToolExecution],
      afterToolExecution: [afterToolExecution],
      afterLoopIteration: [afterLoopIteration],
      onError: [onError],
    }
  }

  /** Stop a running session. */
  stop(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.loop) {
      session.loop.abort()
    }
    session.info.status = 'done'
    session.info.currentTool = undefined
    this.broadcast(session, { type: 'status', status: 'done', name: session.info.name })
  }

  /** Delete a session and its worktree. */
  async delete(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // Stop if running
    this.stop(sessionId)

    // Remove worktree
    if (session.info.worktree) {
      await this.worktreeManager.remove(sessionId)
    }

    // Close all SSE subscribers
    session.subscribers.clear()
    this.sessions.delete(sessionId)
  }

  /** Get session info. */
  get(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId)?.info
  }

  /** Get messages for a session. Lazy-loads from disk if needed. */
  async getMessages(sessionId: string): Promise<IMessage[]> {
    const session = this.sessions.get(sessionId)
    if (!session) return []
    await this.ensureMessagesLoaded(session)
    // Filter out system/context prefix — only return user/assistant/tool messages
    return session.messages.filter(m => m.role !== 'system')
  }

  /** List all sessions. */
  list(): ManagedSession[] {
    return Array.from(this.sessions.values())
      .map(s => s.info)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }

  /** Subscribe to events for a session. Returns unsubscribe function. */
  subscribe(sessionId: string, listener: (event: SessionEvent) => void): () => void {
    const session = this.sessions.get(sessionId)
    if (!session) return () => {}
    session.subscribers.add(listener)
    return () => { session.subscribers.delete(listener) }
  }

  private broadcast(session: SessionInternal, event: SessionEvent): void {
    for (const listener of session.subscribers) {
      try {
        listener(event)
      } catch {
        // Don't let a bad listener break broadcasting
      }
    }
  }

  /** Shutdown all sessions. */
  async shutdown(): Promise<void> {
    const ids = Array.from(this.sessions.keys())
    for (const id of ids) {
      this.stop(id)
    }
  }
}
