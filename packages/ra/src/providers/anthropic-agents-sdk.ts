import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKPartialAssistantMessage, ThinkingConfig, EffortLevel, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { z } from 'zod/v4'
import { withDoneGuard, extractSystemMessages, extractTextContent, resolveThinkingBudget, THINKING_BUDGETS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, TokenUsage, ThinkingLevel } from './types'

export interface AnthropicAgentsSdkProviderOptions {
  /** Default model (overridden by ChatRequest.model). */
  model?: string
}

/**
 * Provider that wraps the Anthropic Agent SDK as a **model interface only**.
 *
 * The SDK handles model calls (using the user's Anthropic subscription),
 * while ra owns everything else: context engineering, tool execution,
 * permissions, middleware, and the agent loop.
 *
 * Key design:
 * - Fresh subprocess per turn — `query()` is called each `stream()` invocation
 *   with the full conversation history serialized as XML-tagged text.
 * - Tools registered as MCP schemas with no-op handlers (model sees them)
 * - maxTurns=1 ensures the SDK does exactly one model call and returns
 * - Raw stream events parsed into tool_call_start/delta/end chunks for ra's loop
 * - Tool names stripped of SDK's `mcp__<server>__` prefix to match ra's registry
 * - All SDK context engineering disabled — ra owns context
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
    const toolArgBuffers = new Map<string, { name: string; args: string }>()
    for (const c of chunks) {
      if (c.type === 'tool_call_start') toolArgBuffers.set(c.id, { name: c.name, args: '' })
      else if (c.type === 'tool_call_delta') { const buf = toolArgBuffers.get(c.id); if (buf) buf.args += c.argsDelta }
      else if (c.type === 'tool_call_end') {
        const buf = toolArgBuffers.get(c.id)
        if (buf) { toolCalls.push({ id: c.id, name: buf.name, arguments: buf.args }); toolArgBuffers.delete(c.id) }
      }
    }
    const done = chunks.find(c => c.type === 'done') as { type: 'done'; usage?: TokenUsage } | undefined
    return {
      message: { role: 'assistant', content: text, ...(toolCalls.length && { toolCalls }) },
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

      // ── Single turn — ra owns the loop ────────────────────────────
      maxTurns: 1,

      // ── Thinking / effort ─────────────────────────────────────────
      ...this.mapThinking(request.thinking, request.thinkingBudgetCap),
      ...this.mapEffort(request.thinking),
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const { filtered } = extractSystemMessages(request.messages)
    const options = this.buildOptions(request)
    const mcpServer = request.tools?.length
      ? this.buildMcpToolSchemas(request.tools)
      : undefined

    const abortController = new AbortController()
    if (request.signal) {
      if (request.signal.aborted) { abortController.abort(); yield { type: 'done' }; return }
      request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }

    const prompt = this.formatConversation(filtered)
    let session: AsyncIterable<SDKMessage>
    try {
      session = query({
        prompt,
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
   * For multi-turn conversations (after tool execution), the history is
   * serialized as XML-tagged messages so the model can clearly follow
   * the conversation thread.
   */
  formatConversation(messages: IMessage[]): string {
    if (messages.length === 0) return ''
    const parts: string[] = []
    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          parts.push(`<user>\n${extractTextContent(msg.content)}\n</user>`)
          break
        case 'assistant': {
          let text = extractTextContent(msg.content)
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              text += `\n<tool_call id="${tc.id}" name="${tc.name}">${tc.arguments}</tool_call>`
            }
          }
          parts.push(`<assistant>\n${text}\n</assistant>`)
          break
        }
        case 'tool':
          parts.push(`<tool_result id="${msg.toolCallId}"${msg.isError ? ' error="true"' : ''}>\n${extractTextContent(msg.content)}\n</tool_result>`)
          break
      }
    }
    const formatted = parts.join('\n\n')
    const lastMsg = messages[messages.length - 1]
    // For multi-turn conversations with tool results, add a preamble so the
    // model treats the XML as prior history rather than echoing the tags.
    if (lastMsg?.role === 'tool') {
      return HISTORY_PREAMBLE + formatted + '\n\nContinue the conversation based on the tool results above. Do not output XML tags.'
    }
    return formatted
  }

  // ── MCP tool schemas ────────────────────────────────────────────────

  /**
   * Build an MCP server with tool schemas only (no-op handlers).
   *
   * The model sees these tools and can call them. With maxTurns=1 the
   * SDK never executes the handlers — ra's loop handles tool execution.
   */
  buildMcpToolSchemas(tools: ITool[]) {
    const mcpTools = tools.map(t => {
      const zodShape = jsonSchemaToZodShape(t.inputSchema)
      return sdkTool(
        t.name,
        t.description,
        zodShape,
        async () => ({ content: [{ type: 'text' as const, text: '' }] }),
      )
    })
    return createSdkMcpServer({ name: MCP_SERVER_NAME, tools: mcpTools })
  }

  // ── Stream parsing ──────────────────────────────────────────────────

  /**
   * Parse Agent SDK events into ra StreamChunks.
   *
   * Reads messages from the session until the model turn completes.
   * Tool calls are emitted as tool_call_start/delta/end so ra's AgentLoop
   * can execute them. maxTurns=1 ensures the SDK stops after one model call.
   *
   * Tool names are stripped of the SDK's `mcp__<server>__` prefix.
   */
  private async *parseSession(session: AsyncIterable<SDKMessage>): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined
    const activeToolCalls = new Map<number, string>()

    try {
      for await (const msg of session) {
        if (msg.type === 'stream_event') {
          const event = (msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent
          switch (event.type) {
            case 'content_block_start':
              if (event.content_block.type === 'tool_use') {
                activeToolCalls.set(event.index, event.content_block.id)
                yield { type: 'tool_call_start', id: event.content_block.id, name: stripMcpPrefix(event.content_block.name) }
              }
              break
            case 'content_block_delta':
              if (event.delta.type === 'text_delta') {
                yield { type: 'text', delta: event.delta.text }
              } else if (event.delta.type === 'input_json_delta') {
                const toolCallId = activeToolCalls.get(event.index) ?? ''
                yield { type: 'tool_call_delta', id: toolCallId, argsDelta: event.delta.partial_json }
              } else if (event.delta.type === 'thinking_delta') {
                yield { type: 'thinking', delta: (event.delta as { thinking: string }).thinking }
              }
              break
            case 'content_block_stop': {
              const toolCallId = activeToolCalls.get(event.index)
              if (toolCallId) {
                yield { type: 'tool_call_end', id: toolCallId }
                activeToolCalls.delete(event.index)
              }
              break
            }
          }
        } else if (msg.type === 'result') {
          usage = this.extractUsage(msg)
          break
        }
      }
    } catch (err) {
      // Expected SDK error when maxTurns is reached with pending tool calls:
      // - "Reached maximum number of turns" — SDK's error_max_turns
      // The tool call chunks have already been yielded; ra will execute them.
      if (err && typeof err === 'object' && 'message' in err) {
        const message = (err as Error).message
        const isExpected =
          message.includes('maximum number of turns') ||
          message.includes('max_turns')
        if (!isExpected) {
          // Provide a better error when the Claude CLI subprocess fails
          if (message.includes('ENOENT') || message.includes('not found') || message.includes('spawn')) {
            throw new Error(
              'Claude CLI is not installed or not found on PATH. The anthropic-agents-sdk provider requires the Claude CLI. ' +
              'Install it from https://docs.anthropic.com/en/docs/claude-cli or use a different provider (e.g. provider: "anthropic").',
            )
          }
          throw err
        }
      } else {
        throw err
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

/** Preamble added before XML-serialized history on tool-result turns to prevent the model from echoing XML tags. */
const HISTORY_PREAMBLE = 'The following is your previous conversation history including tool calls you made and their results. Use this context to continue the conversation.\n\n'

const MCP_SERVER_NAME = 'ra-tools'
const MCP_PREFIX = `mcp__${MCP_SERVER_NAME}__`

/** Strip the SDK's `mcp__ra-tools__` prefix from tool names so they match ra's registry. */
function stripMcpPrefix(name: string): string {
  return name.startsWith(MCP_PREFIX) ? name.slice(MCP_PREFIX.length) : name
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
