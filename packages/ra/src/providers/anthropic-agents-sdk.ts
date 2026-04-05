import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKPartialAssistantMessage, ThinkingConfig, EffortLevel, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { z } from 'zod'
import { withDoneGuard, extractSystemMessages, extractTextContent, resolveThinkingBudget, THINKING_BUDGETS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, ContentPart, TokenUsage, ThinkingLevel } from './types'

/**
 * Called before each tool execution in the MCP bridge.
 * Return a string to deny (the string is the denial reason).
 * Return undefined to allow.
 */
export type ToolPermissionCheck = (toolName: string, toolInput: Record<string, unknown>) => Promise<string | undefined>

export interface AnthropicAgentsSdkProviderOptions {
  /** Default model (overridden by ChatRequest.model). */
  model?: string
  /**
   * Permission check called before each MCP tool execution.
   * Wire this to ra's permission system (createPermissionsMiddleware) in bootstrap.
   * When it returns a string, the tool call is denied and the reason is sent to the model.
   */
  checkToolPermission?: ToolPermissionCheck
}

/**
 * Provider that wraps the Anthropic Agent SDK (claude-agent-sdk).
 *
 * Uses the Anthropic subscription for model calls instead of API credits.
 * The SDK handles the full agent loop autonomously — model calls, tool
 * execution (via MCP bridge to ra's tool registry), and multi-turn
 * conversations all happen inside a single stream() call.
 *
 * Ra's tools are registered as MCP tools with real handlers that:
 * 1. Check permissions via the checkToolPermission callback
 * 2. Execute the tool via tool.execute()
 * 3. Return the result (or denial reason) to the SDK
 *
 * Tool activity (calls + results) is streamed as text chunks so the user
 * sees what's happening in real time.
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
 */
export class AnthropicAgentsSdkProvider implements IProvider {
  readonly name = 'anthropic-agents-sdk'
  private defaultModel?: string
  private checkToolPermission?: ToolPermissionCheck

  constructor(options: AnthropicAgentsSdkProviderOptions = {}) {
    this.defaultModel = options.model
    this.checkToolPermission = options.checkToolPermission
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
    // Collect text chunks from tool activity so we can yield them between stream events
    const toolTextQueue: string[] = []
    const mcpServer = request.tools?.length
      ? this.buildMcpServer(request.tools, toolTextQueue)
      : undefined

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

    yield* withDoneGuard(this.parseSession(session, toolTextQueue))
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
   *
   * Each MCP handler:
   * 1. Pushes a text description of the tool call to toolTextQueue (for streaming display)
   * 2. Checks permissions via checkToolPermission (if configured)
   * 3. Executes the tool via tool.execute()
   * 4. Pushes a text description of the result to toolTextQueue
   * 5. Returns the result (or error) to the SDK
   */
  buildMcpServer(tools: ITool[], toolTextQueue: string[] = []) {
    const permCheck = this.checkToolPermission
    const mcpTools = tools.map(t => {
      const zodShape = jsonSchemaToZodShape(t.inputSchema)
      return sdkTool(
        t.name,
        t.description,
        zodShape,
        async (args: Record<string, unknown>) => {
          const argsStr = JSON.stringify(args)
          toolTextQueue.push(`\n◆ ${t.name} ${argsStr}\n`)

          // Permission check
          if (permCheck) {
            const denial = await permCheck(t.name, args)
            if (denial) {
              toolTextQueue.push(`✗ denied: ${denial}\n`)
              return { content: [{ type: 'text' as const, text: denial }], isError: true }
            }
          }

          try {
            const result = await t.execute(args)
            const text = typeof result === 'string' ? result : JSON.stringify(result)
            const preview = text.length > 200 ? text.slice(0, 200) + '…' : text
            toolTextQueue.push(`✓ ${t.name} (${text.length} chars)\n`)
            return { content: [{ type: 'text' as const, text }] }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            toolTextQueue.push(`✗ ${t.name} error: ${message}\n`)
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
   * Yields text and thinking from all model turns. Between stream events,
   * flushes any tool activity text that MCP handlers have queued up,
   * so the user sees tool calls and results in real time.
   */
  private async *parseSession(session: AsyncIterable<SDKMessage>, toolTextQueue: string[]): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined

    for await (const msg of session) {
      // Flush any pending tool activity text before processing the next event
      while (toolTextQueue.length > 0) {
        yield { type: 'text', delta: toolTextQueue.shift()! }
      }

      if (msg.type === 'stream_event') {
        const event = (msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text', delta: event.delta.text }
          } else if (event.delta.type === 'thinking_delta') {
            yield { type: 'thinking', delta: (event.delta as { thinking: string }).thinking }
          }
        }
      } else if (msg.type === 'result') {
        usage = this.extractUsage(msg)
      }
    }

    // Final flush of any remaining tool text
    while (toolTextQueue.length > 0) {
      yield { type: 'text', delta: toolTextQueue.shift()! }
    }
    yield { type: 'done', ...(usage && { usage }) }
  }

  /**
   * Extract token usage from an SDK result message.
   * Prefers modelUsage (aggregated per-model breakdown with cache tokens)
   * over the raw API usage field.
   */
  private extractUsage(msg: { subtype?: string; usage?: unknown; modelUsage?: unknown }): TokenUsage | undefined {
    // modelUsage is a Record<string, ModelUsage> with camelCase fields — aggregated across all turns
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

    // Fallback: raw API usage (snake_case fields from BetaUsage)
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
