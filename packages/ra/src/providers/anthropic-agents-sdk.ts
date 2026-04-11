import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKPartialAssistantMessage, SDKUserMessage, ThinkingConfig, EffortLevel, SettingSource, Query } from '@anthropic-ai/claude-agent-sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { z } from 'zod/v4'
import { withDoneGuard, extractSystemMessages, extractTextContent, resolveThinkingBudget, THINKING_BUDGETS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, TokenUsage, ThinkingLevel, ContentPart } from './types'

export interface AnthropicAgentsSdkProviderOptions {
  /** Default model (overridden by ChatRequest.model). */
  model?: string
  /**
   * CC session UUID to resume on startup. Persisted by the caller (e.g.
   * SessionManager) so that a freshly-constructed provider after an ra
   * process restart can reattach to CC's server-side conversation state
   * instead of starting a brand-new session.
   */
  resumeSessionId?: string
  /**
   * Called whenever the provider captures a CC session UUID (from the
   * `init` system message). The caller should persist this so it can be
   * passed back as `resumeSessionId` on the next provider construction.
   */
  onSessionId?: (sessionId: string) => void
}

interface PersistentSession {
  query: Query
  inbox: Inbox<SDKUserMessage>
  abortController: AbortController
  fingerprint: string
  /** Number of messages from the previous ChatRequest that we have already seeded into the session. */
  sentMessages: number
  /**
   * CC's own session UUID, captured from the first `init` system message.
   * Used to `resume` the same CC session if the subprocess has to restart
   * (fingerprint change, error recovery, or a new provider instance after
   * an ra process restart). Without this, the rebuilt subprocess would
   * have no memory of prior turns and followups would lose all history.
   */
  sdkSessionId?: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Provider that wraps the Anthropic Agent SDK.
 *
 * The SDK handles model calls (using the user's Anthropic subscription)
 * AND tool execution (via MCP handlers that bridge to ra's tools).
 * ra owns context engineering, the outer conversation loop, and middleware.
 *
 * **One provider instance = one Claude CLI subprocess = one conversation.**
 * Callers that manage multiple concurrent ra sessions (e.g. the web session
 * manager) should instantiate a separate `AnthropicAgentsSdkProvider` per
 * session so the subprocesses — and their prompt caches — stay isolated.
 *
 * Each `stream()` call pushes the new user message into the streaming-input
 * prompt channel and consumes SDK events until the turn's `result` message
 * arrives, then yields control back to ra. The subprocess stays warm across
 * turns. If it has to be rebuilt (fingerprint change, error, process restart),
 * we reattach to the same CC session via `resume` so no history is lost.
 */
export class AnthropicAgentsSdkProvider implements IProvider {
  readonly name = 'anthropic-agents-sdk'
  // The Claude CLI subprocess compacts its own context window — ra must
  // not try to compact on top of it, or we'll double-truncate the history
  // and corrupt the persistent session's state.
  readonly autoContextManaged = true
  private defaultModel?: string
  private session?: PersistentSession
  private turnLock: Promise<void> = Promise.resolve()
  /**
   * CC session UUID to resume on next subprocess start. Survives `teardown()`
   * so that rebuilding the subprocess (for any reason) reattaches to CC's
   * server-side conversation state instead of starting fresh.
   */
  private resumeSessionId?: string

  private onSessionId?: (sessionId: string) => void

  constructor(options: AnthropicAgentsSdkProviderOptions = {}) {
    this.defaultModel = options.model
    if (options.resumeSessionId) this.resumeSessionId = options.resumeSessionId
    this.onSessionId = options.onSessionId
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const chunks: StreamChunk[] = []
    for await (const chunk of this.stream(request)) {
      chunks.push(chunk)
    }
    const text = chunks.filter(c => c.type === 'text').map(c => c.delta).join('')
    const done = chunks.find(c => c.type === 'done') as { type: 'done'; usage?: TokenUsage } | undefined
    return {
      message: { role: 'assistant', content: text },
      usage: done?.usage,
    }
  }

  buildOptions(request: ChatRequest) {
    const { system } = extractSystemMessages(request.messages)
    const model = request.model || this.defaultModel

    return {
      model,
      // ── Context isolation: ra owns ALL context engineering ──────────
      systemPrompt: system || 'You are a helpful AI assistant.',
      settingSources: [] as SettingSource[],
      settings: {
        autoMemoryEnabled: false,
        autoDreamEnabled: false,
        includeGitInstructions: false,
        respectGitignore: false,
      },
      // Enable CC's native session persistence so a fresh subprocess can
      // `resume` the same conversation after ra restarts or the subprocess
      // dies. Without this, mid-conversation subprocess restarts would lose
      // all prior turns (ra only forwards new user messages each turn).
      persistSession: true,
      enableFileCheckpointing: false,
      includePartialMessages: true,
      plugins: [],

      // ── Tool & permission isolation ───────────────────────────────
      tools: [] as string[],
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,

      // ── SDK owns the agentic loop — no maxTurns cap ───────────────
      // The SDK loops (model → tool → model → …) until the model stops
      // calling tools. One subprocess = stable prefix = cache hits OOTB.

      // ── Thinking / effort ─────────────────────────────────────────
      ...this.mapThinking(request.thinking, request.thinkingBudgetCap),
      ...this.mapEffort(request.thinking),
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    // Serialize turns: only one stream() call may drive the subprocess at a time.
    const prev = this.turnLock
    let release!: () => void
    this.turnLock = new Promise<void>(r => { release = r })
    try {
      await prev
    } catch {
      // ignore — previous turn's rejection is its own caller's problem
    }

    try {
      if (request.signal?.aborted) {
        yield { type: 'done' }
        return
      }

      const fingerprint = this.fingerprint(request)
      const { filtered } = extractSystemMessages(request.messages)

      // Seed `resumeSessionId` from the caller's ra session id on the very
      // first call against a new provider instance. This makes the CC side
      // use a stable, caller-supplied UUID so subsequent resume attempts
      // find the right persisted session even across ra process restarts.
      // Only used when the session is cold (no subprocess yet) and we don't
      // already have a captured `sdkSessionId` from a prior turn.
      if (!this.session && !this.resumeSessionId && request.sessionId && UUID_REGEX.test(request.sessionId)) {
        this.resumeSessionId = request.sessionId
      }

      // Restart the subprocess if: fingerprint (model/system/tools/thinking)
      // changed, OR the caller's message history shrunk below what we
      // already sent (compaction / reset — ra's view has diverged from the
      // SDK's internal state and we can't sync cleanly). CC's server-side
      // session state survives the teardown: on the next `startSession` we
      // `resume` it so no history is lost.
      if (
        this.session &&
        (this.session.fingerprint !== fingerprint || filtered.length < this.session.sentMessages)
      ) {
        await this.teardown()
      }
      if (!this.session) {
        this.startSession(request, fingerprint)
      }
      const session = this.session!

      // Forward every ra message the SDK hasn't seen yet. Assistant messages
      // are skipped (the SDK emitted them itself), user messages pass through,
      // and tool messages are wrapped as user messages so seeded/injected
      // tool results still reach the model. When we just resumed a CC session
      // after a subprocess rebuild, `sentMessages` is 0 so we replay all of
      // ra's history — but CC itself already has the prior turns persisted,
      // and the streaming-input inbox only accepts new user/tool turns after
      // the `resume`, so in practice only the trailing untracked user/tool
      // messages reach the model.
      const toSend: SDKUserMessage[] = []
      for (const msg of filtered.slice(session.sentMessages)) {
        const sdkMsg = this.toSdkMessage(msg)
        if (sdkMsg) toSend.push(sdkMsg)
      }
      session.sentMessages = filtered.length

      // Nothing new to push means the agent loop would hang waiting for a
      // `result` that never comes — the SDK only speaks when spoken to.
      if (toSend.length === 0) {
        throw new Error('AnthropicAgentsSdkProvider.stream: no new user/tool messages to send — the persistent session needs new input each turn.')
      }
      for (const msg of toSend) session.inbox.push(msg)

      // Per-turn abort: interrupt the SDK's current turn. We also tear down
      // on abort because the interrupted query can't be cleanly resumed.
      const onAbort = () => {
        try { session.query.interrupt?.()?.catch?.(() => {}) } catch { /* ignore */ }
        if (!session.abortController.signal.aborted) session.abortController.abort()
      }
      request.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        yield* withDoneGuard(this.parseOneTurn(session))
      } catch (err) {
        await this.teardown()
        this.rethrowCliError(err)
      } finally {
        request.signal?.removeEventListener('abort', onAbort)
        if (request.signal?.aborted) await this.teardown()
      }
    } finally {
      release()
    }
  }

  private startSession(request: ChatRequest, fingerprint: string) {
    const options = this.buildOptions(request)
    const mcpServer = request.tools?.length ? this.buildMcpTools(request.tools) : undefined
    const abortController = new AbortController()
    const inbox = makeInbox<SDKUserMessage>()

    // Resume CC's server-side session if we know its id (either captured from
    // a previous init event, or supplied by the caller via request.sessionId
    // on the first cold-start). This is what keeps history intact across
    // subprocess rebuilds — ra no longer has to replay transcripts manually.
    const resumeId = this.resumeSessionId

    let q: Query
    try {
      q = query({
        prompt: inbox,
        options: {
          ...options,
          abortController,
          ...(resumeId && { resume: resumeId }),
          ...(mcpServer && { mcpServers: { [MCP_SERVER_NAME]: mcpServer } }),
        },
      })
    } catch (err) {
      this.rethrowCliError(err)
    }

    this.session = {
      query: q!,
      inbox,
      abortController,
      fingerprint,
      sentMessages: 0,
      sdkSessionId: resumeId,
    }
  }

  private async teardown() {
    const session = this.session
    if (!session) return
    this.session = undefined
    // Preserve the CC session id so the next startSession() can resume it —
    // the subprocess is gone but CC has the conversation state persisted.
    if (session.sdkSessionId) this.resumeSessionId = session.sdkSessionId
    try { await session.query.interrupt() } catch { /* ignore */ }
    session.inbox.close()
    if (!session.abortController.signal.aborted) session.abortController.abort()
    try { await session.query.return(undefined) } catch { /* ignore */ }
  }

  private rethrowCliError(err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('spawn') || msg.includes('claude')) {
      throw new Error(
        'Claude CLI is not installed or not found on PATH. The anthropic-agents-sdk provider requires the Claude CLI. ' +
        'Install it from https://docs.anthropic.com/en/docs/claude-cli or use a different provider (e.g. provider: "anthropic").',
      )
    }
    throw err instanceof Error ? err : new Error(msg)
  }

  private fingerprint(request: ChatRequest): string {
    const { system } = extractSystemMessages(request.messages)
    const toolNames = (request.tools ?? []).map(t => t.name).sort().join(',')
    return JSON.stringify({
      model: request.model ?? this.defaultModel ?? '',
      system: system ?? '',
      thinking: request.thinking ?? '',
      cap: request.thinkingBudgetCap ?? 0,
      tools: toolNames,
    })
  }

  private mapThinking(thinking?: ThinkingLevel, budgetCap?: number): { thinking?: ThinkingConfig } {
    if (!thinking) return {}
    const budget = resolveThinkingBudget(THINKING_BUDGETS, thinking, budgetCap)
    return { thinking: { type: 'enabled', budgetTokens: budget } }
  }

  private mapEffort(thinking?: ThinkingLevel): { effort?: EffortLevel } {
    if (!thinking) return {}
    const map: Record<ThinkingLevel, EffortLevel> = { low: 'low', medium: 'medium', high: 'high' }
    return { effort: map[thinking] }
  }

  // ── Message formatting ───────────────────────────────────────────────

  /**
   * Map an ra message to an SDK streaming-input user message.
   * - user  → pass through (text + native image blocks).
   * - tool  → forward as a native `tool_result` content block, preserving
   *           `tool_use_id` and `is_error`. The SDK normally handles tool
   *           execution internally, but seeded/injected tool results still
   *           reach the model this way without string mangling.
   * - assistant / other → undefined (already in SDK state, skip).
   */
  toSdkMessage(msg: IMessage): SDKUserMessage | undefined {
    if (msg.role === 'user') return this.toSdkUserMessage(msg)
    if (msg.role === 'tool') {
      if (!msg.toolCallId) return undefined
      const block: ContentBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId,
        content: extractTextContent(msg.content),
        ...(msg.isError && { is_error: true }),
      }
      return { type: 'user', message: { role: 'user', content: [block] }, parent_tool_use_id: null }
    }
    return undefined
  }

  /**
   * Convert one ra user message into the SDK's streaming-input user message.
   * Text is passed through as-is; images are preserved as native Anthropic
   * image blocks. Since the SDK retains conversation history across turns
   * inside the persistent subprocess, only the new user message is sent.
   */
  toSdkUserMessage(msg: IMessage): SDKUserMessage {
    const text = extractTextContent(msg.content)
    const imageBlocks: ContentBlockParam[] = []
    if (typeof msg.content !== 'string') {
      for (const part of msg.content as ContentPart[]) {
        if (part.type !== 'image') continue
        const src = part.source
        if (src.type === 'base64') {
          imageBlocks.push({
            type: 'image',
            source: { type: 'base64', media_type: src.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: src.data },
          })
        } else {
          imageBlocks.push({ type: 'image', source: { type: 'url', url: src.url } })
        }
      }
    }
    const content: string | ContentBlockParam[] = imageBlocks.length
      ? [{ type: 'text', text }, ...imageBlocks]
      : text
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
  }

  // ── MCP tools with real handlers ───────────────────────────────────

  /**
   * Build an MCP server with **real** tool handlers.
   *
   * Each handler calls `tool.execute()`, so the SDK can run its own
   * agentic loop: model → tool_use → execute via MCP → tool_result →
   * model → … until the model stops calling tools. This keeps the
   * subprocess alive for the full turn, giving Anthropic's prompt cache
   * a stable prefix to hit on every follow-up API call.
   */
  buildMcpTools(tools: ITool[]) {
    const mcpTools = tools.map(t => {
      const zodShape = jsonSchemaToZodShape(t.inputSchema)
      return sdkTool(
        t.name,
        t.description,
        zodShape,
        async (input: Record<string, unknown>) => {
          try {
            const result = await t.execute(input)
            const text = typeof result === 'string' ? result : JSON.stringify(result)
            return { content: [{ type: 'text' as const, text }] }
          } catch (err) {
            const text = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text }], isError: true }
          }
        },
      )
    })
    return createSdkMcpServer({ name: MCP_SERVER_NAME, tools: mcpTools })
  }

  // ── Stream parsing ──────────────────────────────────────────────────

  /**
   * Consume SDK events for a single turn. Yields text/thinking chunks
   * until the SDK emits its `result` message, then returns — leaving
   * the underlying Query paused, ready for the next user message.
   * Tool calls are resolved by the SDK internally and are not surfaced.
   *
   * Captures CC's session UUID from the `init` system message so we can
   * `resume` it if the subprocess has to restart later.
   */
  private async *parseOneTurn(session: PersistentSession): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined
    // Manual iteration — using `for await ... break` would implicitly call
    // `.return()` on the iterator and close the generator, which would kill
    // the persistent subprocess. We need to stop pulling at the turn's
    // `result` message without signalling the generator to terminate.
    const iter = session.query[Symbol.asyncIterator]()
    while (true) {
      const step = await iter.next()
      if (step.done) break
      const msg = step.value
      if (msg.type === 'stream_event') {
        const event = (msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', delta: event.delta.text }
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking', delta: (event.delta as { thinking: string }).thinking }
          }
        }
      } else if (msg.type === 'system' && msg.subtype === 'init') {
        const id = (msg as { session_id?: string }).session_id
        if (id) {
          session.sdkSessionId = id
          this.resumeSessionId = id
          this.onSessionId?.(id)
        }
      } else if (msg.type === 'result') {
        usage = this.extractUsage(msg)
        break
      }
    }
    yield { type: 'done', ...(usage && { usage }) }
  }

  /**
   * Extract token usage from an SDK result message.
   * Prefers modelUsage (aggregated per-model breakdown with cache tokens)
   * over the raw API usage field.
   */
  private extractUsage(msg: { subtype?: string; usage?: unknown; modelUsage?: unknown }): TokenUsage | undefined {
    if (msg.modelUsage && typeof msg.modelUsage === 'object') {
      const models = msg.modelUsage as Record<string, {
        inputTokens?: number
        outputTokens?: number
        cacheReadInputTokens?: number
        cacheCreationInputTokens?: number
      }>
      let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheCreate = 0
      for (const m of Object.values(models)) {
        inputTokens += m.inputTokens ?? 0
        outputTokens += m.outputTokens ?? 0
        cacheRead += m.cacheReadInputTokens ?? 0
        cacheCreate += m.cacheCreationInputTokens ?? 0
      }
      return {
        inputTokens: inputTokens + cacheRead + cacheCreate,
        outputTokens,
        ...(cacheRead && { cacheReadTokens: cacheRead }),
        ...(cacheCreate && { cacheCreationTokens: cacheCreate }),
      }
    }

    if (!msg.usage) return undefined
    const u = msg.usage as {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    const cacheRead = u.cache_read_input_tokens ?? 0
    const cacheCreate = u.cache_creation_input_tokens ?? 0
    return {
      inputTokens: (u.input_tokens ?? 0) + cacheRead + cacheCreate,
      outputTokens: u.output_tokens ?? 0,
      ...(cacheRead && { cacheReadTokens: cacheRead }),
      ...(cacheCreate && { cacheCreationTokens: cacheCreate }),
    }
  }
}

const MCP_SERVER_NAME = 'ra-tools'

interface Inbox<T> extends AsyncIterable<T> {
  push(value: T): void
  close(): void
}

/**
 * Unbounded async FIFO backing the SDK's streaming-input prompt channel.
 * Keeping this iterable open is what keeps the Claude CLI subprocess alive
 * between turns — the SDK waits for the next user message instead of exiting.
 */
function makeInbox<T>(): Inbox<T> {
  const queue: T[] = []
  let pending: ((r: IteratorResult<T>) => void) | null = null
  let closed = false

  return {
    push(value: T) {
      if (closed) return
      if (pending) {
        const resolve = pending
        pending = null
        resolve({ value, done: false })
      } else {
        queue.push(value)
      }
    },
    close() {
      if (closed) return
      closed = true
      if (pending) {
        const resolve = pending
        pending = null
        resolve({ value: undefined as never, done: true })
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: (): Promise<IteratorResult<T>> => {
          if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false })
          if (closed) return Promise.resolve({ value: undefined as never, done: true })
          return new Promise<IteratorResult<T>>(resolve => { pending = resolve })
        },
        return: (): Promise<IteratorResult<T>> => {
          closed = true
          return Promise.resolve({ value: undefined as never, done: true })
        },
      }
    },
  }
}

function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodType> {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  const required = new Set((schema.required ?? []) as string[])
  const shape: Record<string, z.ZodType> = {}
  for (const [key, prop] of Object.entries(properties)) {
    let field = jsonSchemaTypeToZod(prop)
    if (!required.has(key)) field = field.optional()
    shape[key] = field
  }
  return shape
}

function jsonSchemaTypeToZod(prop: Record<string, unknown>): z.ZodType {
  switch (prop.type) {
    case 'string':
      if (prop.enum) return z.enum(prop.enum as [string, ...string[]])
      return z.string()
    case 'number':
    case 'integer':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      if (prop.items && typeof prop.items === 'object') return z.array(jsonSchemaTypeToZod(prop.items as Record<string, unknown>))
      return z.array(z.unknown())
    case 'object':
      if (prop.properties) return z.object(jsonSchemaToZodShape(prop))
      return z.record(z.string(), z.unknown())
    default:
      return z.unknown()
  }
}
