import Anthropic from '@anthropic-ai/sdk'
import { extractSystemMessages, extractUsage, mergeConsecutiveRoles, parseToolArguments, serializeContent, THINKING_BUDGETS, DEFAULT_MAX_TOKENS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, ContentPart, TokenUsage } from './types'


export interface AnthropicProviderOptions {
  apiKey: string
  baseURL?: string
}

export class AnthropicProvider implements IProvider {
  readonly name = 'anthropic'
  private client: Anthropic

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseURL })
  }

  buildParams(request: ChatRequest) {
    const { system, filtered } = extractSystemMessages(request.messages)
    return {
      model: request.model,
      max_tokens: (request.providerOptions?.maxTokens as number) ?? DEFAULT_MAX_TOKENS,
      messages: this.mapMessages(filtered),
      ...(system && { system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }] }),
      ...(request.tools?.length && { tools: this.mapTools(request.tools) }),
      ...(request.thinking && { thinking: { type: 'enabled', budget_tokens: THINKING_BUDGETS[request.thinking] } }),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.messages.create(this.buildParams(request) as Anthropic.MessageCreateParamsNonStreaming)
    const responseUsage = response.usage as unknown as Record<string, number>
    const usage: TokenUsage = {
      inputTokens: responseUsage.input_tokens ?? 0,
      outputTokens: responseUsage.output_tokens ?? 0,
      ...((responseUsage.cache_read_input_tokens ?? 0) > 0 && { cacheReadTokens: responseUsage.cache_read_input_tokens }),
      ...((responseUsage.cache_creation_input_tokens ?? 0) > 0 && { cacheCreationTokens: responseUsage.cache_creation_input_tokens }),
    }
    return { message: this.mapResponseToMessage(response), usage }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const stream = await this.client.messages.create(
      { ...this.buildParams(request), stream: true } as Anthropic.MessageCreateParamsStreaming,
      ...(request.signal ? [{ signal: request.signal }] : []),
    )

    let usage: TokenUsage | undefined
    let inputTokens = 0
    let cacheReadTokens = 0
    let cacheCreationTokens = 0
    let emittedDone = false
    const activeToolCalls = new Map<number, string>()

    for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
      switch (event.type) {
        case 'message_start': {
          const msgUsage = (event as Anthropic.RawMessageStartEvent).message.usage as unknown as Record<string, number> | undefined
          inputTokens = msgUsage?.input_tokens ?? 0
          cacheReadTokens = msgUsage?.cache_read_input_tokens ?? 0
          cacheCreationTokens = msgUsage?.cache_creation_input_tokens ?? 0
          break
        }
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            activeToolCalls.set(event.index, event.content_block.id)
            yield { type: 'tool_call_start', id: event.content_block.id, name: event.content_block.name }
          }
          break
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text }
          else if (event.delta.type === 'input_json_delta') yield { type: 'tool_call_delta', id: activeToolCalls.get(event.index) ?? '', argsDelta: event.delta.partial_json }
          else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: (event.delta as unknown as { thinking: string }).thinking }
          break
        case 'message_delta':
          usage = {
            inputTokens,
            outputTokens: (event as Anthropic.RawMessageDeltaEvent).usage.output_tokens,
            ...(cacheReadTokens > 0 && { cacheReadTokens }),
            ...(cacheCreationTokens > 0 && { cacheCreationTokens }),
          }
          break
        case 'message_stop':
          emittedDone = true
          yield { type: 'done', usage }
          break
      }
    }
    if (!emittedDone) yield { type: 'done', usage }
  }

  mapMessages(messages: IMessage[]): Anthropic.MessageParam[] {
    const mapped = messages.map((msg): Anthropic.MessageParam => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.toolCallId ?? '', content: serializeContent(msg.content) }],
        }
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: Anthropic.ContentBlockParam[] = []
        if (typeof msg.content === 'string' && msg.content) content.push({ type: 'text', text: msg.content })
        else if (Array.isArray(msg.content)) content.push(...this.mapContentParts(msg.content))
        for (const tc of msg.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: parseToolArguments(tc.arguments) })
        }
        return { role: 'assistant', content }
      }
      // user or assistant without tool calls
      const role = msg.role as 'user' | 'assistant'
      return typeof msg.content === 'string'
        ? { role, content: msg.content }
        : { role, content: this.mapContentParts(msg.content) }
    })
    const merged = mergeConsecutiveRoles(mapped)
    // Add cache breakpoints on the last two user turns (Anthropic allows up to 4 total).
    // System prompt and last tool already have breakpoints (2 used).
    // Two conversation breakpoints give a rolling cache: even when the last turn is new,
    // the second-to-last is a guaranteed hit from the previous iteration.
    this.addConversationCacheBreakpoints(merged)
    return merged
  }

  /** Add cache_control to the last content block of a user-role message. */
  private markUserMessage(msg: Anthropic.MessageParam): void {
    if (typeof msg.content === 'string') {
      msg.content = [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }]
    } else if (Array.isArray(msg.content) && msg.content.length > 0) {
      const last = msg.content[msg.content.length - 1]!
      ;(last as unknown as Record<string, unknown>).cache_control = { type: 'ephemeral' }
    }
  }

  /** Place cache breakpoints on the last two user-role messages. */
  private addConversationCacheBreakpoints(messages: Anthropic.MessageParam[]): void {
    let marked = 0
    for (let i = messages.length - 1; i >= 0 && marked < 2; i--) {
      if (messages[i]!.role === 'user') {
        this.markUserMessage(messages[i]!)
        marked++
      }
    }
  }

  mapTools(tools: ITool[]): Anthropic.Tool[] {
    return tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      ...(i === tools.length - 1 && { cache_control: { type: 'ephemeral' as const } }),
    }))
  }

  mapContentParts(parts: ContentPart[]): Anthropic.ContentBlockParam[] {
    return parts.map((part): Anthropic.ContentBlockParam => {
      if (part.type === 'text') return { type: 'text', text: part.text }
      if (part.type === 'image') {
        const src = part.source
        return src.type === 'base64'
          ? { type: 'image', source: { type: 'base64', media_type: src.mediaType as Anthropic.Base64ImageSource['media_type'], data: src.data } }
          : { type: 'image', source: { type: 'url', url: src.url } }
      }
      return { type: 'document', source: { type: 'base64', media_type: part.mimeType as Anthropic.Base64PDFSource['media_type'], data: typeof part.data === 'string' ? part.data : Buffer.from(part.data).toString('base64') } }
    })
  }

  mapResponseToMessage(response: Anthropic.Message): IMessage {
    const toolCalls: IToolCall[] = []
    let textContent = ''
    for (const block of response.content) {
      if (block.type === 'text') textContent += block.text
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) })
    }
    return { role: 'assistant', content: textContent, ...(toolCalls.length && { toolCalls }) }
  }
}
