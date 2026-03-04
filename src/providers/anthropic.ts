import Anthropic from '@anthropic-ai/sdk'
import { extractSystemMessages } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, ContentPart, TokenUsage } from './types'

const THINKING_BUDGETS = { low: 1000, medium: 8000, high: 32000 } as const

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

  private buildParams(request: ChatRequest) {
    const { system, filtered } = extractSystemMessages(request.messages)
    return {
      model: request.model,
      max_tokens: (request.providerOptions?.maxTokens as number) ?? 4096,
      messages: this.mapMessages(filtered),
      ...(system && { system }),
      ...(request.tools?.length && { tools: this.mapTools(request.tools) }),
      ...(request.thinking && { thinking: { type: 'enabled', budget_tokens: THINKING_BUDGETS[request.thinking] } }),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.messages.create(this.buildParams(request) as Anthropic.MessageCreateParamsNonStreaming)
    const usage: TokenUsage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
    return { message: this.mapResponseToMessage(response), usage }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const stream = await this.client.messages.create({ ...this.buildParams(request), stream: true } as Anthropic.MessageCreateParamsStreaming)

    let usage: TokenUsage | undefined
    let currentToolCallId = ''

    for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
      switch (event.type) {
        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            currentToolCallId = event.content_block.id
            yield { type: 'tool_call_start', id: event.content_block.id, name: event.content_block.name }
          }
          break
        case 'content_block_delta':
          if (event.delta.type === 'text_delta') yield { type: 'text', delta: event.delta.text }
          else if (event.delta.type === 'input_json_delta') yield { type: 'tool_call_delta', id: currentToolCallId, argsDelta: event.delta.partial_json }
          else if (event.delta.type === 'thinking_delta') yield { type: 'thinking', delta: (event.delta as any).thinking }
          break
        case 'message_delta':
          usage = { inputTokens: (event as Anthropic.RawMessageDeltaEvent).usage.input_tokens ?? 0, outputTokens: (event as Anthropic.RawMessageDeltaEvent).usage.output_tokens }
          break
        case 'message_stop':
          yield { type: 'done', usage }
          break
      }
    }
  }

  private mapMessages(messages: IMessage[]): Anthropic.MessageParam[] {
    return messages.map((msg): Anthropic.MessageParam => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: msg.toolCallId!, content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }],
        }
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: Anthropic.ContentBlockParam[] = []
        if (typeof msg.content === 'string' && msg.content) content.push({ type: 'text', text: msg.content })
        else if (Array.isArray(msg.content)) content.push(...this.mapContentParts(msg.content))
        for (const tc of msg.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: JSON.parse(tc.arguments) as Record<string, unknown> })
        }
        return { role: 'assistant', content }
      }
      if (typeof msg.content === 'string') return { role: msg.role as 'user' | 'assistant', content: msg.content }
      return { role: msg.role as 'user' | 'assistant', content: this.mapContentParts(msg.content) }
    })
  }

  private mapTools(tools: ITool[]): Anthropic.Tool[] {
    return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool['input_schema'] }))
  }

  private mapContentParts(parts: ContentPart[]): Anthropic.ContentBlockParam[] {
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

  private mapResponseToMessage(response: Anthropic.Message): IMessage {
    const toolCalls: IToolCall[] = []
    let textContent = ''
    for (const block of response.content) {
      if (block.type === 'text') textContent += block.text
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, arguments: JSON.stringify(block.input) })
    }
    return { role: 'assistant', content: textContent, ...(toolCalls.length && { toolCalls }) }
  }
}
