import { query, createSdkMcpServer, tool as sdkTool } from '@anthropic-ai/claude-agent-sdk'
import type { SDKMessage, SDKResultSuccess, SDKAssistantMessage, SDKPartialAssistantMessage, ThinkingConfig } from '@anthropic-ai/claude-agent-sdk'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { z } from 'zod'
import { withDoneGuard, extractSystemMessages, extractTextContent } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, TokenUsage, ThinkingLevel } from './types'

export interface AgentSdkProviderOptions {
  /** Optional model override (can also be set per-request via ChatRequest.model). */
  model?: string
}

export class AgentSdkProvider implements IProvider {
  readonly name = 'agent-sdk'
  private defaultModel?: string

  constructor(options: AgentSdkProviderOptions = {}) {
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

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const { system, filtered } = extractSystemMessages(request.messages)
    const prompt = this.formatConversation(filtered)
    const mcpServer = request.tools?.length ? this.buildMcpServer(request.tools) : undefined
    const model = request.model || this.defaultModel

    const abortController = new AbortController()
    if (request.signal) {
      request.signal.addEventListener('abort', () => abortController.abort(), { once: true })
    }

    const session = query({
      prompt,
      options: {
        ...(model && { model }),
        maxTurns: 1,
        tools: [],
        ...(system && { systemPrompt: system }),
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        ...(mcpServer && { mcpServers: { 'ra-tools': mcpServer } }),
        abortController,
        ...this.mapThinking(request.thinking),
      },
    })

    yield* withDoneGuard(this.parseSession(session))
  }

  /** Map ra's ThinkingLevel to Agent SDK thinking config. */
  private mapThinking(thinking?: ThinkingLevel): { thinking?: ThinkingConfig } {
    if (!thinking) return {}
    const budgets = { low: 1024, medium: 16000, high: 32000 } as const
    return { thinking: { type: 'enabled', budgetTokens: budgets[thinking] } }
  }

  /** Format ra message history into a string prompt for the Agent SDK. */
  formatConversation(messages: IMessage[]): string {
    if (messages.length === 0) return ''
    // Single user message — pass through directly
    if (messages.length === 1 && messages[0]!.role === 'user') {
      return extractTextContent(messages[0]!.content)
    }
    // Multi-turn: format as structured conversation
    const parts: string[] = []
    for (const msg of messages) {
      switch (msg.role) {
        case 'user':
          parts.push(`[User]\n${extractTextContent(msg.content)}`)
          break
        case 'assistant': {
          let text = extractTextContent(msg.content)
          if (msg.toolCalls?.length) {
            for (const tc of msg.toolCalls) {
              text += `\n<tool_call id="${tc.id}" name="${tc.name}">${tc.arguments}</tool_call>`
            }
          }
          parts.push(`[Assistant]\n${text}`)
          break
        }
        case 'tool':
          parts.push(`[Tool Result id="${msg.toolCallId}"${msg.isError ? ' error="true"' : ''}]\n${extractTextContent(msg.content)}`)
          break
      }
    }
    return parts.join('\n\n')
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
        const event = (msg as SDKPartialAssistantMessage).event as BetaRawMessageStreamEvent
        yield* this.parseStreamEvent(event, activeToolCalls)
      } else if (msg.type === 'assistant') {
        // Complete assistant message — extract tool calls if streaming didn't catch them
        yield* this.parseAssistantMessage(msg as SDKAssistantMessage, activeToolCalls)
      } else if (msg.type === 'result') {
        usage = this.extractUsage(msg as SDKResultSuccess | { subtype: string })
      }
    }
    yield { type: 'done', ...(usage && { usage }) }
  }

  /** Parse a single BetaRawMessageStreamEvent into StreamChunks. */
  private *parseStreamEvent(
    event: BetaRawMessageStreamEvent,
    activeToolCalls: Map<number, string>,
  ): Iterable<StreamChunk> {
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
          const id = activeToolCalls.get(event.index) ?? ''
          yield { type: 'tool_call_delta', id, argsDelta: event.delta.partial_json }
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

  /** Fallback: extract tool calls from a complete assistant message when stream events are missing. */
  private *parseAssistantMessage(
    msg: SDKAssistantMessage,
    alreadySeen: Map<number, string>,
  ): Iterable<StreamChunk> {
    if (!msg.message?.content) return
    // If we already got tool calls from streaming, skip
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

  /** Extract token usage from result message. */
  private extractUsage(msg: { subtype: string; usage?: unknown }): TokenUsage | undefined {
    if (!('usage' in msg) || !msg.usage) return undefined
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
