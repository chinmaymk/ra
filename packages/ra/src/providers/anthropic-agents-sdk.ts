import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKPartialAssistantMessage, SDKUserMessage, ThinkingConfig, EffortLevel, SettingSource, Query } from '@anthropic-ai/claude-agent-sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { z } from 'zod/v4'
import { withDoneGuard, extractSystemMessages, extractTextContent, resolveThinkingBudget, THINKING_BUDGETS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, TokenUsage, ThinkingLevel } from './types'

export interface AnthropicAgentsSdkProviderOptions {
  /** Default model (overridden by ChatRequest.model). */
  model?: string
}

/**
 * Provider that wraps the Anthropic Agent SDK.
 *
 * The SDK handles model calls (using the user's Anthropic subscription)
 * AND tool execution (via MCP handlers that bridge to ra's tools).
 * ra owns context engineering, the outer conversation loop, and middleware.
 *
 * Key design:
 * - **One subprocess per provider instance** (not per stream() call). A persistent
 *   `Query` is kept alive behind a pushable user-message channel; each `stream()`
 *   call pushes the next user turn and drains messages until the SDK's per-turn
 *   `result` event. This avoids the CLI-startup + MCP-handshake cost on every turn.
 * - Tools registered as MCP tools with **real handlers** that call `tool.execute()`
 *   via a mutable lookup map, so the latest `execute` reference is always used
 *   even if ra re-creates the ITool objects between turns.
 * - The SDK runs its own agentic loop (model → tool → model → …) inside one turn,
 *   so ra's AgentLoop still sees a text-only response per iteration.
 * - Only text/thinking chunks are surfaced to ra; tool calls are resolved
 *   internally by the SDK.
 *
 * Session invalidation: if `model`, system prompt, tool schemas, or thinking
 * config change between calls — or if a prior turn errored / was interrupted —
 * the existing subprocess is closed and a fresh one is started on the next call.
 */
export class AnthropicAgentsSdkProvider implements IProvider {
  readonly name = 'anthropic-agents-sdk'
  private defaultModel?: string
  private session?: Session
  /** Serialises concurrent stream() calls onto the same subprocess. */
  private streamLock: Promise<void> = Promise.resolve()

  constructor(options: AnthropicAgentsSdkProviderOptions = {}) {
    this.defaultModel = options.model
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
      persistSession: false,
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
    // Serialise concurrent callers — the subprocess handles one turn at a time.
    const prev = this.streamLock
    let release!: () => void
    this.streamLock = new Promise<void>(r => { release = r })
    try {
      await prev
      yield* withDoneGuard(this.streamOnSession(request))
    } finally {
      release()
    }
  }

  /**
   * Explicitly terminate the underlying subprocess. Idempotent.
   *
   * Useful in long-lived hosts that want to reclaim resources without waiting
   * for the next session-invalidating request. After `close()`, the next
   * `stream()` call will start a fresh subprocess.
   */
  async close(): Promise<void> {
    const session = this.session
    if (!session) return
    this.session = undefined
    try { session.query.close() } catch { /* ignore */ }
    session.channel.close()
  }

  private async *streamOnSession(request: ChatRequest): AsyncIterable<StreamChunk> {
    if (request.signal?.aborted) { yield { type: 'done' }; return }

    const { filtered } = extractSystemMessages(request.messages)
    const key = this.sessionKey(request)

    let session = this.session
    if (session && !this.isSessionReusable(session, key, filtered)) {
      try { session.query.close() } catch { /* ignore */ }
      session.channel.close()
      this.session = undefined
      session = undefined
    }

    if (!session) {
      session = this.createSession(request, key, filtered)
      this.session = session
    } else {
      // Reuse: refresh tool execute() refs and push new user messages.
      this.refreshTools(session, request.tools ?? [])
      this.pushNewMessages(session, filtered)
    }

    // Hook request.signal → query.interrupt() so the subprocess halts the
    // in-flight turn but stays alive for the next call.
    let interrupted = false
    const onAbort = () => {
      interrupted = true
      session!.query.interrupt().catch(() => { /* swallow */ })
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })

    try {
      yield* this.parseQuery(session.query)
    } catch (err) {
      // Any error leaves the session in an unknown state — tear it down so
      // the next stream() call starts fresh.
      this.invalidateSession()
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('ENOENT') || message.includes('not found') || message.includes('spawn') || message.includes('claude')) {
        throw new Error(
          'Claude CLI is not installed or not found on PATH. The anthropic-agents-sdk provider requires the Claude CLI. ' +
          'Install it from https://docs.anthropic.com/en/docs/claude-cli or use a different provider (e.g. provider: "anthropic").',
        )
      }
      throw err
    } finally {
      request.signal?.removeEventListener('abort', onAbort)
      // If we interrupted, the subprocess may still be mid-turn state — retire it.
      if (interrupted) this.invalidateSession()
    }
  }

  // ── Session management ────────────────────────────────────────────

  private createSession(request: ChatRequest, key: string, filtered: IMessage[]): Session {
    const channel = new UserMessageChannel()
    const options = this.buildOptions(request)

    // Mutable tool lookup: handlers always call the latest execute ref.
    const toolMap = new Map<string, ITool>()
    for (const t of request.tools ?? []) toolMap.set(t.name, t)
    const mcpServer = toolMap.size > 0 ? this.buildMcpServer([...toolMap.values()], toolMap) : undefined

    // Seed the channel with the initial wrapped conversation so the very
    // first next() in the subprocess has something to read.
    channel.push({
      type: 'user',
      message: { role: 'user', content: this.formatConversation(filtered) },
      parent_tool_use_id: null,
    })

    let queryInstance: Query
    try {
      queryInstance = query({
        prompt: channel,
        options: {
          ...options,
          ...(mcpServer && { mcpServers: { [MCP_SERVER_NAME]: mcpServer } }),
        },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('claude')) {
        throw new Error(
          'Claude CLI is not installed or not found on PATH. The anthropic-agents-sdk provider requires the Claude CLI. ' +
          'Install it from https://docs.anthropic.com/en/docs/claude-cli or use a different provider (e.g. provider: "anthropic").',
        )
      }
      throw err
    }

    return {
      query: queryInstance,
      channel,
      key,
      toolMap,
      sentDigests: filtered.map(digestMessage),
    }
  }

  private invalidateSession(): void {
    const s = this.session
    if (!s) return
    this.session = undefined
    try { s.query.close() } catch { /* ignore */ }
    s.channel.close()
  }

  /**
   * A session is reusable if the static params match AND the message list is
   * an extension of what we've already sent. Any mismatch (compaction, history
   * rewrite, model change, …) forces a fresh subprocess.
   */
  private isSessionReusable(session: Session, newKey: string, filtered: IMessage[]): boolean {
    if (session.key !== newKey) return false
    if (filtered.length < session.sentDigests.length) return false
    for (let i = 0; i < session.sentDigests.length; i++) {
      if (digestMessage(filtered[i]!) !== session.sentDigests[i]) return false
    }
    return true
  }

  /** Push any messages added since the last call; update the sent-digest cursor. */
  private pushNewMessages(session: Session, filtered: IMessage[]): void {
    const start = session.sentDigests.length
    for (let i = start; i < filtered.length; i++) {
      const msg = filtered[i]!
      // Only user-role messages need to be sent; the SDK already has the
      // assistant responses it produced, and tool results are resolved inside
      // the SDK via MCP so we have no faithful way to inject them here.
      if (msg.role === 'user') {
        session.channel.push({
          type: 'user',
          message: { role: 'user', content: extractTextContent(msg.content) },
          parent_tool_use_id: null,
        })
      }
    }
    session.sentDigests = filtered.map(digestMessage)
  }

  /**
   * Refresh execute() references for tools whose name/description/schema are
   * unchanged. (Schema changes invalidate the session entirely — caught by
   * `sessionKey`.)
   */
  private refreshTools(session: Session, tools: ITool[]): void {
    for (const t of tools) session.toolMap.set(t.name, t)
  }

  /**
   * Build the session-identity key. Must include every aspect that would
   * require a fresh subprocess if changed: model, system prompt, tool schemas,
   * thinking config. Execute functions are intentionally excluded so that
   * transient ITool re-creations don't trigger a restart.
   */
  private sessionKey(request: ChatRequest): string {
    const { system } = extractSystemMessages(request.messages)
    const toolKey = (request.tools ?? [])
      .map(t => `${t.name}\t${t.description}\t${JSON.stringify(t.inputSchema)}`)
      .sort()
      .join('\n')
    return JSON.stringify({
      model: request.model || this.defaultModel || null,
      system: system ?? null,
      tools: toolKey,
      thinking: request.thinking ?? null,
      budgetCap: request.thinkingBudgetCap ?? null,
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
   * Format ra's conversation history as a text prompt for the SDK.
   *
   * Only the user-facing conversation is serialized (user messages and
   * prior assistant text). Tool calls and results from earlier turns
   * are omitted because the SDK handled them internally — the model
   * already saw them during that subprocess's agentic loop.
   */
  formatConversation(messages: IMessage[]): string {
    if (messages.length === 0) return ''
    const parts: string[] = []
    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          parts.push(`<user>\n${extractTextContent(msg.content)}\n</user>`)
          break
        case 'assistant':
          parts.push(`<assistant>\n${extractTextContent(msg.content)}\n</assistant>`)
          break
        // tool results omitted — the SDK resolved them internally
      }
    }
    return `<conversation_history>\n${parts.join('\n\n')}`
  }

  // ── MCP tools with real handlers ───────────────────────────────────

  /**
   * Build an MCP server with **real** tool handlers.
   *
   * Each handler calls `tool.execute()`, so the SDK can run its own
   * agentic loop: model → tool_use → execute via MCP → tool_result →
   * model → … until the model stops calling tools.
   */
  buildMcpTools(tools: ITool[]) {
    const toolMap = new Map<string, ITool>(tools.map(t => [t.name, t]))
    return this.buildMcpServer(tools, toolMap)
  }

  private buildMcpServer(schemaTools: ITool[], lookup: Map<string, ITool>) {
    const mcpTools = schemaTools.map(t => {
      const zodShape = jsonSchemaToZodShape(t.inputSchema)
      return sdkTool(
        t.name,
        t.description,
        zodShape,
        async (input: Record<string, unknown>) => {
          const current = lookup.get(t.name) ?? t
          try {
            const result = await current.execute(input)
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
   * Drain one turn from the persistent Query — messages up to and including
   * the first `result` event. Uses manual `next()` iteration so that `break`
   * does not call `return()` on the generator (which would close the
   * subprocess we're trying to keep alive).
   */
  private async *parseQuery(queryInstance: Query): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined
    let ended = false

    while (true) {
      let result: IteratorResult<SDKMessage, void>
      try {
        result = await queryInstance.next()
      } catch (err) {
        // Propagate; streamOnSession will invalidate the session.
        throw err
      }
      if (result.done) { ended = true; break }
      const msg = result.value
      if (msg.type === 'stream_event') {
        const event = (msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', delta: event.delta.text }
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking', delta: (event.delta as { thinking: string }).thinking }
          }
          // tool_call deltas are handled by the SDK — don't surface them
        }
      } else if (msg.type === 'result') {
        usage = this.extractUsage(msg as { usage?: unknown; modelUsage?: unknown })
        break
      }
      // Any other message type (system init, partial assistant frame, …) is
      // informational and ignored.
    }

    if (ended) {
      // Generator closed upstream (subprocess exit, channel end). The session
      // is no longer usable.
      this.invalidateSession()
    }
    yield { type: 'done', ...(usage && { usage }) }
  }

  /**
   * Extract token usage from an SDK result message.
   * Prefers modelUsage (aggregated per-model breakdown with cache tokens)
   * over the raw API usage field.
   */
  private extractUsage(msg: { usage?: unknown; modelUsage?: unknown }): TokenUsage | undefined {
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

interface Session {
  query: Query
  channel: UserMessageChannel
  /** Static-params hash — any change forces a fresh subprocess. */
  key: string
  /** Content-digest of every message forwarded to the subprocess so far. */
  sentDigests: string[]
  /** Mutable name → ITool lookup — MCP handlers always resolve via this map. */
  toolMap: Map<string, ITool>
}

/**
 * Pushable async iterable used as `query({ prompt })`. Lets the provider keep
 * the SDK subprocess alive between turns: each new user message is `push()`ed
 * into the channel, and the SDK's internal consumer wakes up to read it.
 */
class UserMessageChannel implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiter: ((r: IteratorResult<SDKUserMessage, undefined>) => void) | null = null
  private closed = false

  push(msg: SDKUserMessage): void {
    if (this.closed) return
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w({ value: msg, done: false })
      return
    }
    this.queue.push(msg)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w({ value: undefined, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, undefined> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage, undefined>> => {
        if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift()!, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise(resolve => { this.waiter = resolve })
      },
      return: (): Promise<IteratorResult<SDKUserMessage, undefined>> => {
        this.close()
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
}

/** Stable content digest for prefix comparison across stream() calls. */
function digestMessage(msg: IMessage): string {
  const text = extractTextContent(msg.content)
  const toolCalls = msg.toolCalls ? msg.toolCalls.map(tc => `${tc.id}:${tc.name}:${tc.arguments}`).join('|') : ''
  return `${msg.role}\x00${msg.toolCallId ?? ''}\x00${toolCalls}\x00${text}`
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
