import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKPartialAssistantMessage, ThinkingConfig, EffortLevel, SettingSource } from '@anthropic-ai/claude-agent-sdk'
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
 * The SDK handles the full agent loop autonomously — model calls, tool
 * execution (via MCP bridge to ra's tool registry), and multi-turn
 * conversations all happen inside a single stream() call.
 *
 * Ra's tools are registered as MCP tools with real handlers that call
 * tool.execute(). The SDK invokes them when the model generates tool_use
 * blocks. Text and thinking chunks from all turns are streamed back to ra.
 * Ra's loop sees the final text response with no pending tool calls and
 * completes in a single iteration.
 *
 * All SDK context engineering is disabled — ra owns context:
 * - settingSources: []                    → no CLAUDE.md / .claude/settings.json
 * - settings.autoMemoryEnabled: false     → no auto-memory files
 * - settings.autoDreamEnabled: false      → no background consolidation
 * - settings.includeGitInstructions: false→ no git instructions injected
 * - settings.respectGitignore: false      → no .gitignore reading
 * - persistSession: false                 → no session files on disk
 * - enableFileCheckpointing: false        → no file tracking
 * - plugins: []                           → no plugins from disk
 * - tools: []                             → no built-in tools
 * - systemPrompt: string                  → REPLACES SDK default
 *
 * Limitations:
 * - Images/files in conversation history described as metadata (binary
 *   data cannot be embedded in a text prompt).
 * - Each stream() spawns a Claude Code subprocess (adds latency).
 * - Requires Claude Code installed and the user logged in.
 * - Ra's beforeToolExecution/afterToolExecution middleware hooks do not
 *   fire — the SDK handles tool execution directly via MCP.
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

  buildParams(request: ChatRequest) {
    const { system, filtered } = extractSystemMessages(request.messages)
    const prompt = this.formatConversation(filtered)
    const model = request.model || this.defaultModel

    return {
      prompt,
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
      plugins: [],

      // ── Tool & permission isolation ───────────────────────────────
      tools: [] as string[],
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,

      // ── Thinking / effort ─────────────────────────────────────────
      ...this.mapThinking(request.thinking, request.thinkingBudgetCap),
      ...this.mapEffort(request.thinking),
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const params = this.buildParams(request)
    const mcpServer = request.tools?.length ? this.buildMcpServer(request.tools) : undefined

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
        ...(mcpServer && { mcpServers: { 'ra-tools': mcpServer } }),
      },
    })

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

  /**
   * Build an MCP server that bridges ra's tools to the Agent SDK.
   * The SDK calls these handlers when the model generates tool_use blocks.
   * Each handler executes the real tool via tool.execute().
   */
  buildMcpServer(tools: ITool[]) {
    const mcpTools = tools.map(t => {
      const zodShape = jsonSchemaToZodShape(t.inputSchema)
      return sdkTool(
        t.name,
        t.description,
        zodShape,
        async (args: Record<string, unknown>) => {
          try {
            const result = await t.execute(args)
            const text = typeof result === 'string' ? result : JSON.stringify(result)
            return { content: [{ type: 'text' as const, text }] }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true }
          }
        },
      )
    })
    return createSdkMcpServer({ name: 'ra-tools', tools: mcpTools })
  }

  /**
   * Parse Agent SDK events into ra StreamChunks.
   *
   * The SDK handles the full agent loop (model → tools → model → ...).
   * We stream text and thinking deltas from ALL turns so the user sees
   * intermediate output. Tool call chunks are NOT yielded — the SDK
   * already executed them via the MCP bridge.
   */
  private async *parseSession(session: AsyncIterable<SDKMessage>): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined

    for await (const msg of session) {
      if (msg.type === 'stream_event') {
        const event = (msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', delta: event.delta.text }
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking', delta: (event.delta as { thinking: string }).thinking }
          }
          // input_json_delta (tool call args) intentionally not yielded —
          // tool execution is handled by the SDK via MCP.
        }
      } else if (msg.type === 'result') {
        usage = this.extractUsage(msg)
      }
    }
    yield { type: 'done', ...(usage && { usage }) }
  }

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
      return z.record(z.unknown())
    default:
      return z.unknown()
  }
}
