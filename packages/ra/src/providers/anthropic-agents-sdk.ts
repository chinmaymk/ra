import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKAssistantMessage, SDKPartialAssistantMessage, ThinkingConfig, EffortLevel, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { z } from 'zod'
import { withDoneGuard, extractSystemMessages, extractTextContent, resolveThinkingBudget, THINKING_BUDGETS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, ContentPart, TokenUsage, ThinkingLevel } from './types'

export interface AnthropicAgentsSdkProviderOptions {
  /** Default model (overridden by ChatRequest.model). */
  model?: string
}

/**
 * Provider that wraps the Anthropic Agent SDK (claude-agent-sdk).
 *
 * Uses the Anthropic subscription for model calls instead of API credits.
 * Each stream() call creates a fresh query() session with maxTurns: 1 so the
 * SDK makes exactly one model call and returns — ra handles tool execution,
 * middleware, and the agent loop itself.
 *
 * All SDK "magic" is explicitly disabled:
 * - settingSources: []                    → no CLAUDE.md / .claude/settings.json loading
 * - settings.autoMemoryEnabled: false     → no auto-memory files
 * - settings.autoDreamEnabled: false      → no background memory consolidation
 * - settings.includeGitInstructions: false→ no git workflow instructions injected
 * - settings.respectGitignore: false      → no .gitignore file reading
 * - persistSession: false                 → no session files written to/read from disk
 * - enableFileCheckpointing: false        → no file change tracking
 * - plugins: []                           → no plugins loaded from disk
 * - tools: []                             → no built-in tools (Read, Write, Bash, etc.)
 * - permissionMode: 'bypassPermissions'   → no permission prompts
 * - systemPrompt: string                  → REPLACES SDK default (no hidden instructions)
 *
 * Limitations:
 * - Images and files in conversation history are described as metadata (binary
 *   data cannot be embedded in a text prompt). The latest user message's
 *   text content IS preserved.
 * - Each stream() call spawns a Claude Code subprocess. This adds latency
 *   compared to direct API providers.
 * - Requires Claude Code to be installed and the user to be logged in.
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
    const toolCalls: IToolCall[] = []
    const argsBuf = new Map<string, { id: string; name: string; args: string }>()
    for (const c of chunks) {
      if (c.type === 'tool_call_start') argsBuf.set(c.id, { id: c.id, name: c.name, args: '' })
      else if (c.type === 'tool_call_delta') { const b = argsBuf.get(c.id); if (b) b.args += c.argsDelta }
      else if (c.type === 'tool_call_end') { const b = argsBuf.get(c.id); if (b) toolCalls.push({ id: b.id, name: b.name, arguments: b.args }) }
    }
    const done = chunks.find(c => c.type === 'done') as { type: 'done'; usage?: TokenUsage } | undefined
    return {
      message: { role: 'assistant', content: text, ...(toolCalls.length && { toolCalls }) },
      usage: done?.usage,
    }
  }

  buildParams(request: ChatRequest) {
    const { system, filtered } = extractSystemMessages(request.messages)
    const prompt = this.formatConversation(filtered)
    const model = request.model || this.defaultModel
    const mcpServer = request.tools?.length ? this.buildMcpServer(request.tools) : undefined

    return {
      prompt,
      model,
      // ── Context isolation: ra owns ALL context engineering ──────────
      // REPLACES the SDK default system prompt — no hidden instructions
      systemPrompt: system || 'You are a helpful AI assistant.',
      // No filesystem settings/CLAUDE.md/.claude/ loading at all
      settingSources: [] as SettingSource[],
      // Inline settings — never load from file. Disable every auto-read feature.
      settings: {
        autoMemoryEnabled: false,       // no auto-memory files
        autoDreamEnabled: false,        // no background consolidation
        includeGitInstructions: false,  // no git workflow instructions injected
        respectGitignore: false,        // don't read .gitignore
      },
      // No session files written to or read from disk
      persistSession: false,
      // No file change tracking
      enableFileCheckpointing: false,
      // No plugins loaded from disk
      plugins: [],

      // ── Tool & permission isolation: ra owns tools and permissions ─
      // No built-in tools (Read, Write, Bash, etc.) — ra provides via MCP
      tools: [] as string[],
      // Skip all permission checks — ra handles permissions
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      maxTurns: 1,
      includePartialMessages: true,

      // ── Thinking / effort ─────────────────────────────────────────
      ...this.mapThinking(request.thinking, request.thinkingBudgetCap),
      ...this.mapEffort(request.thinking),

      // ── Provider options passthrough ──────────────────────────────
      ...(request.providerOptions?.maxTurns ? { maxTurns: request.providerOptions.maxTurns as number } : {}),

      // ── MCP tools (ra's tools bridged to the SDK) ─────────────────
      ...(mcpServer && { mcpServers: { 'ra-tools': mcpServer } }),
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const params = this.buildParams(request)

    const abortController = new AbortController()
    if (request.signal) {
      if (request.signal.aborted) { abortController.abort(); yield { type: 'done' }; return }
      request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }

    const { prompt, ...options } = params
    const session = query({
      prompt,
      options: {
        ...options,
        abortController,
      },
    })

    yield* withDoneGuard(this.parseSession(session))
  }

  /** Map ra's ThinkingLevel + budget cap to Agent SDK thinking config. */
  private mapThinking(thinking?: ThinkingLevel, budgetCap?: number): { thinking?: ThinkingConfig } {
    if (!thinking) return {}
    const budget = resolveThinkingBudget(THINKING_BUDGETS, thinking, budgetCap)
    return { thinking: { type: 'enabled', budgetTokens: budget } }
  }

  /** Map thinking level to Agent SDK effort level. */
  private mapEffort(thinking?: ThinkingLevel): { effort?: EffortLevel } {
    if (!thinking) return {}
    const map: Record<ThinkingLevel, EffortLevel> = { low: 'low', medium: 'medium', high: 'high' }
    return { effort: map[thinking] }
  }

  /**
   * Format ra message history into a string prompt for the Agent SDK.
   *
   * The Agent SDK's query() accepts a string prompt (treated as the user message).
   * For multi-turn conversations, we encode the full history as structured text
   * so the model can understand the context and continue appropriately.
   *
   * Content parts (images, files) in history are described as metadata since
   * binary data cannot be embedded in a text prompt.
   */
  formatConversation(messages: IMessage[]): string {
    if (messages.length === 0) return ''
    if (messages.length === 1 && messages[0]!.role === 'user') {
      return this.formatContent(messages[0]!.content)
    }
    const parts: string[] = []
    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          parts.push(`[User]\n${this.formatContent(msg.content)}`)
          break
        case 'assistant': {
          let text = this.formatContent(msg.content)
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              text += `\n<tool_call id="${tc.id}" name="${tc.name}">${tc.arguments}</tool_call>`
            }
          }
          parts.push(`[Assistant]\n${text}`)
          break
        }
        case 'tool':
          parts.push(`[Tool Result id="${msg.toolCallId}"${msg.isError ? ' error="true"' : ''}]\n${this.formatContent(msg.content)}`)
          break
      }
    }
    return parts.join('\n\n')
  }

  /**
   * Format message content, preserving text and describing non-text parts.
   * Binary content (images, files) cannot be embedded in a text prompt,
   * so they are described as metadata.
   */
  private formatContent(content: string | ContentPart[]): string {
    if (typeof content === 'string') return content
    return content.map(part => {
      if (part.type === 'text') return part.text
      if (part.type === 'image') {
        const src = part.source
        return src.type === 'url'
          ? `[Image: ${src.url}]`
          : `[Image: ${src.mediaType} (base64, ${src.data.length} chars)]`
      }
      return `[File: ${part.mimeType}]`
    }).join('\n')
  }

  /** Build an in-process MCP server from ra's tool definitions. */
  buildMcpServer(tools: ITool[]) {
    const mcpTools = tools.map(t => {
      const zodShape = jsonSchemaToZodShape(t.inputSchema)
      return sdkTool(
        t.name,
        t.description,
        zodShape,
        async () => ({ content: [{ type: 'text' as const, text: '[tool execution deferred to ra]' }] }),
      )
    })
    return createSdkMcpServer({ name: 'ra-tools', tools: mcpTools })
  }

  /** Parse Agent SDK streaming events into ra StreamChunks. */
  private async *parseSession(session: AsyncIterable<SDKMessage>): AsyncIterable<StreamChunk> {
    const activeToolCalls = new Map<number, string>()
    let usage: TokenUsage | undefined

    for await (const msg of session) {
      if (msg.type === 'stream_event') {
        yield* this.parseStreamEvent((msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent, activeToolCalls)
      } else if (msg.type === 'assistant') {
        yield* this.parseAssistantMessage(msg as SDKAssistantMessage, activeToolCalls)
      } else if (msg.type === 'result') {
        usage = this.extractUsage(msg)
      }
      // All other SDK events (system, status, hooks, etc.) are intentionally ignored —
      // ra does not need them since it manages its own loop and lifecycle.
    }
    yield { type: 'done', ...(usage && { usage }) }
  }

  /** Parse a single BetaRawMessageStreamEvent into StreamChunks. */
  private *parseStreamEvent(event: BetaRawMessageStreamEvent, activeToolCalls: Map<number, string>): Iterable<StreamChunk> {
    switch (event.type) {
      case 'content_block_start':
        if (event.content_block.type === 'tool_use') {
          activeToolCalls.set(event.index, event.content_block.id)
          yield { type: 'tool_call_start', id: event.content_block.id, name: event.content_block.name }
        }
        break
      case 'content_block_delta':
        if (event.delta.type === 'text_delta') {
          yield { type: 'text', delta: event.delta.text }
        } else if (event.delta.type === 'input_json_delta') {
          yield { type: 'tool_call_delta', id: activeToolCalls.get(event.index) ?? '', argsDelta: event.delta.partial_json }
        } else if (event.delta.type === 'thinking_delta') {
          yield { type: 'thinking', delta: (event.delta as { thinking: string }).thinking }
        }
        break
      case 'content_block_stop': {
        const id = activeToolCalls.get(event.index)
        if (id) {
          yield { type: 'tool_call_end', id }
          activeToolCalls.delete(event.index)
        }
        break
      }
    }
  }

  /** Fallback: extract tool calls from a complete assistant message when stream events were not emitted. */
  private *parseAssistantMessage(msg: SDKAssistantMessage, alreadySeen: Map<number, string>): Iterable<StreamChunk> {
    if (!msg.message?.content) return
    if (alreadySeen.size > 0) return
    for (const block of msg.message.content) {
      if (block.type === 'tool_use') {
        yield { type: 'tool_call_start', id: block.id, name: block.name }
        const args = JSON.stringify(block.input)
        if (args !== '{}') yield { type: 'tool_call_delta', id: block.id, argsDelta: args }
        yield { type: 'tool_call_end', id: block.id }
      }
    }
  }

  /** Extract token usage from an SDK result message. */
  private extractUsage(msg: { subtype?: string; usage?: unknown }): TokenUsage | undefined {
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

/**
 * Convert a JSON Schema properties object to a Zod shape.
 * Handles common types; falls back to z.unknown() for complex schemas.
 */
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
      if (prop.items && typeof prop.items === 'object') {
        return z.array(jsonSchemaTypeToZod(prop.items as Record<string, unknown>))
      }
      return z.array(z.unknown())
    case 'object':
      if (prop.properties) return z.object(jsonSchemaToZodShape(prop))
      return z.record(z.unknown())
    default:
      return z.unknown()
  }
}
