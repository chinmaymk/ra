import OpenAI from 'openai'
import type { IProvider, IMessage, ITool, ChatRequest, ChatResponse, StreamChunk, ContentPart, TokenUsage } from './types'

export interface OpenAIProviderOptions {
  apiKey: string
  baseURL?: string
}

export class OpenAIProvider implements IProvider {
  name = 'openai'
  protected client: OpenAI

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL })
  }

  buildParams(request: ChatRequest): OpenAI.Chat.ChatCompletionCreateParams {
    const params: OpenAI.Chat.ChatCompletionCreateParams = {
      model: request.model,
      messages: this.mapMessages(request.messages),
    }
    if (request.tools?.length) params.tools = this.mapTools(request.tools)
    if (request.providerOptions) Object.assign(params, request.providerOptions)
    if (request.thinking) (params as any).reasoning = { effort: request.thinking }
    return params
  }

  toUsage(u: { prompt_tokens: number; completion_tokens: number; completion_tokens_details?: { reasoning_tokens?: number } }): TokenUsage {
    return {
      inputTokens: u.prompt_tokens,
      outputTokens: u.completion_tokens,
      ...(u.completion_tokens_details?.reasoning_tokens && { thinkingTokens: u.completion_tokens_details.reasoning_tokens }),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.chat.completions.create({ ...this.buildParams(request), stream: false })
    const choice = response.choices[0]
    if (!choice) throw new Error('No choices returned from OpenAI')
    return {
      message: this.mapResponseToMessage(choice.message),
      usage: response.usage ? this.toUsage(response.usage) : undefined,
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const stream = await this.client.chat.completions.create(
      { ...this.buildParams(request), stream: true, stream_options: { include_usage: true } },
      ...(request.signal ? [{ signal: request.signal }] : []),
    )
    const activeToolCalls = new Map<number, string>()
    let usage: TokenUsage | undefined

    for await (const chunk of stream as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>) {
      if (chunk.usage) usage = this.toUsage(chunk.usage)

      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) yield { type: 'text', delta: delta.content }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            activeToolCalls.set(tc.index, tc.id)
            yield { type: 'tool_call_start', id: tc.id, name: tc.function?.name ?? '' }
          }
          if (tc.function?.arguments) {
            yield { type: 'tool_call_delta', id: activeToolCalls.get(tc.index) ?? '', argsDelta: tc.function.arguments }
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        for (const id of activeToolCalls.values()) yield { type: 'tool_call_end', id }
      }
    }

    yield { type: 'done', usage }
  }

  mapMessages(messages: IMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
    return messages.map((msg): OpenAI.Chat.ChatCompletionMessageParam => {
      if (msg.role === 'system') {
        return { role: 'system', content: typeof msg.content === 'string' ? msg.content : msg.content.map(p => p.type === 'text' ? p.text : '').join('') }
      }
      if (msg.role === 'tool') {
        return { role: 'tool', content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content), tool_call_id: msg.toolCallId ?? '' }
      }
      if (msg.role === 'assistant') {
        const content = typeof msg.content === 'string'
          ? msg.content
          : msg.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
        const result: OpenAI.Chat.ChatCompletionAssistantMessageParam = { role: 'assistant', content: content || null }
        if (msg.toolCalls?.length) {
          result.tool_calls = msg.toolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.arguments } }))
        }
        return result
      }
      // user
      const content = typeof msg.content === 'string' ? msg.content : this.mapContentParts(msg.content)
      return { role: 'user', content }
    })
  }

  mapTools(tools: ITool[]): OpenAI.Chat.ChatCompletionTool[] {
    return tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema as Record<string, unknown> } }))
  }

  mapContentParts(parts: ContentPart[]): OpenAI.Chat.ChatCompletionContentPart[] {
    return parts.map((part): OpenAI.Chat.ChatCompletionContentPart => {
      if (part.type === 'text') return { type: 'text', text: part.text }
      if (part.type === 'image') {
        const url = part.source.type === 'base64' ? `data:${part.source.mediaType};base64,${part.source.data}` : part.source.url
        return { type: 'image_url', image_url: { url } }
      }
      return { type: 'text', text: `[file: ${part.mimeType}]` }
    })
  }

  mapResponseToMessage(msg: OpenAI.Chat.ChatCompletionMessage): IMessage {
    const result: IMessage = { role: 'assistant', content: msg.content ?? '' }
    if (msg.tool_calls?.length) {
      result.toolCalls = msg.tool_calls
        .filter((tc): tc is OpenAI.Chat.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
        .map(tc => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }))
    }
    return result
  }
}
