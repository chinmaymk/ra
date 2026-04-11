import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKPartialAssistantMessage, SDKUserMessage, ThinkingConfig, EffortLevel, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { z } from 'zod/v4'
import { withDoneGuard, extractSystemMessages, extractTextContent, resolveThinkingBudget, THINKING_BUDGETS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, TokenUsage, ThinkingLevel, ContentPart } from './types'

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
 * - Tools registered as MCP tools with **real handlers** that call `tool.execute()`
 * - The SDK runs its own agentic loop (model → tool → model → …) inside
 *   a single `query()` call, so one subprocess handles the full turn
 * - Caching works OOTB: one subprocess = stable system prompt + tools prefix
 * - Only text/thinking chunks are surfaced to ra; tool calls are resolved
 *   internally by the SDK, so ra's AgentLoop sees a text-only response
 */
export class AnthropicAgentsSdkProvider implements IProvider {
  readonly name = 'anthropic-agents-sdk'
  private defaultModel?: string

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
    const { filtered } = extractSystemMessages(request.messages)
    const options = this.buildOptions(request)
    const mcpServer = request.tools?.length
      ? this.buildMcpTools(request.tools)
      : undefined

    const abortController = new AbortController()
    if (request.signal) {
      if (request.signal.aborted) { abortController.abort(); yield { type: 'done' }; return }
      request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }

    const promptContent = this.buildPromptContent(filtered)
    let session: AsyncIterable<SDKMessage>
    try {
      session = query({
        prompt: promptIterable(promptContent),
        options: {
          ...options,
          abortController,
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

    yield* withDoneGuard(this.parseSession(session))
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

  /**
   * Build the SDK prompt content, preserving image attachments from user
   * messages as native Anthropic image content blocks. The text conversation
   * history is wrapped in <conversation_history>, and any images collected
   * from user messages are appended as inline image blocks so the model
   * actually receives them.
   */
  buildPromptContent(messages: IMessage[]): string | ContentBlockParam[] {
    const text = this.formatConversation(messages)
    const imageBlocks: ContentBlockParam[] = []
    for (const msg of messages) {
      if (msg.role !== 'user' || typeof msg.content === 'string') continue
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
    if (imageBlocks.length === 0) return text
    return [{ type: 'text', text }, ...imageBlocks]
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
   * Parse Agent SDK events into ra StreamChunks.
   *
   * The SDK may run multiple agentic turns (model → tool → model → …)
   * inside one `query()` call. We surface **only text and thinking**
   * chunks — tool calls are resolved by the SDK internally, so ra's
   * AgentLoop sees a clean text-only response and terminates after one
   * iteration.
   */
  private async *parseSession(session: AsyncIterable<SDKMessage>): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined

    try {
      for await (const msg of session) {
        if (msg.type === 'stream_event') {
          const event = (msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent
          switch (event.type) {
            case 'content_block_delta':
              if (event.delta.type === 'text_delta') {
                yield { type: 'text', delta: event.delta.text }
              } else if (event.delta.type === 'thinking_delta') {
                yield { type: 'thinking', delta: (event.delta as { thinking: string }).thinking }
              }
              // tool_call deltas are handled by the SDK — don't surface them
              break
          }
        } else if (msg.type === 'result') {
          usage = this.extractUsage(msg)
          break
        }
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as Error).message
        if (message.includes('ENOENT') || message.includes('not found') || message.includes('spawn')) {
          throw new Error(
            'Claude CLI is not installed or not found on PATH. The anthropic-agents-sdk provider requires the Claude CLI. ' +
            'Install it from https://docs.anthropic.com/en/docs/claude-cli or use a different provider (e.g. provider: "anthropic").',
          )
        }
        throw err
      }
      throw err
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
const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`

/** Strip the SDK's `mcp__ra-tools__` prefix from tool names so they match ra's registry. */
function stripMcpPrefix(name: string): string {
  return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name
}

/**
 * Wrap the formatted prompt in an async generator so `query()` runs in
 * streaming-input mode, where the SDK applies automatic cache_control
 * breakpoints.
 */
async function* promptIterable(content: string | ContentBlockParam[]): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
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
