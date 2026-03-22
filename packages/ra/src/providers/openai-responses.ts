import OpenAI from 'openai'
import { extractTextContent, serializeContent } from './utils'
import type { IProvider, IMessage, ITool, ChatRequest, ChatResponse, StreamChunk, ContentPart, TokenUsage } from './types'

export interface OpenAIResponsesProviderOptions {
  apiKey: string
  baseURL?: string
}

export class OpenAIResponsesProvider implements IProvider {
  name = 'openai'
  protected client: OpenAI

  constructor(options: OpenAIResponsesProviderOptions) {
    this.client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL })
  }

  buildParams(request: ChatRequest): OpenAI.Responses.ResponseCreateParams {
    const { instructions, input } = this.mapMessages(request.messages)
    const params: Record<string, unknown> = {
      model: request.model,
      input,
      ...(instructions && { instructions }),
    }
    if (request.tools?.length) params.tools = this.mapTools(request.tools)
    if (request.providerOptions) Object.assign(params, request.providerOptions)
    if (request.thinking) params.reasoning = { effort: request.thinking }
    return params as OpenAI.Responses.ResponseCreateParams
  }

  toUsage(u: {
    input_tokens: number
    output_tokens: number
    output_tokens_details?: { reasoning_tokens?: number }
    input_tokens_details?: { cached_tokens?: number }
  }): TokenUsage {
    return {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      ...(u.output_tokens_details?.reasoning_tokens && { thinkingTokens: u.output_tokens_details.reasoning_tokens }),
      ...(u.input_tokens_details?.cached_tokens && { cacheReadTokens: u.input_tokens_details.cached_tokens }),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const params = this.buildParams(request)
    const response = await this.client.responses.create({ ...params, stream: false } as OpenAI.Responses.ResponseCreateParamsNonStreaming)
    return {
      message: this.mapResponseToMessage(response),
      usage: response.usage ? this.toUsage(response.usage) : undefined,
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const params = this.buildParams(request)
    const stream = await this.client.responses.create(
      { ...params, stream: true } as OpenAI.Responses.ResponseCreateParamsStreaming,
      ...(request.signal ? [{ signal: request.signal }] : []),
    )
    const activeToolCalls = new Map<number, string>() // output_index → call_id
    let usage: TokenUsage | undefined

    for await (const event of stream as AsyncIterable<OpenAI.Responses.ResponseStreamEvent>) {
      switch (event.type) {
        case 'response.output_text.delta':
          yield { type: 'text', delta: event.delta }
          break

        case 'response.reasoning_text.delta':
          yield { type: 'thinking', delta: event.delta }
          break

        case 'response.output_item.added': {
          const item = event.item
          if (item.type === 'function_call') {
            activeToolCalls.set(event.output_index, item.call_id)
            yield { type: 'tool_call_start', id: item.call_id, name: item.name }
          }
          break
        }

        case 'response.function_call_arguments.delta':
          yield { type: 'tool_call_delta', id: activeToolCalls.get(event.output_index) ?? event.item_id, argsDelta: event.delta }
          break

        case 'response.function_call_arguments.done': {
          const callId = activeToolCalls.get(event.output_index) ?? event.item_id
          yield { type: 'tool_call_end', id: callId }
          break
        }

        case 'response.completed':
          if (event.response.usage) {
            usage = this.toUsage(event.response.usage)
          }
          break
      }
    }

    yield { type: 'done', usage }
  }

  mapMessages(messages: IMessage[]): { instructions: string | undefined; input: OpenAI.Responses.ResponseInput } {
    let instructions: string | undefined
    const input: OpenAI.Responses.ResponseInputItem[] = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = extractTextContent(msg.content)
        instructions = instructions ? `${instructions}\n\n${text}` : text
        continue
      }

      if (msg.role === 'user') {
        const content = typeof msg.content === 'string'
          ? msg.content
          : this.mapContentParts(msg.content)
        input.push({ type: 'message', role: 'user', content } as OpenAI.Responses.ResponseInputItem)
        continue
      }

      if (msg.role === 'assistant') {
        const text = extractTextContent(msg.content)
        if (text) {
          input.push({ type: 'message', role: 'assistant', content: text } as OpenAI.Responses.ResponseInputItem)
        }
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            input.push({ type: 'function_call', call_id: tc.id, name: tc.name, arguments: tc.arguments } as OpenAI.Responses.ResponseInputItem)
          }
        }
        continue
      }

      if (msg.role === 'tool') {
        input.push({ type: 'function_call_output', call_id: msg.toolCallId ?? '', output: serializeContent(msg.content) } as OpenAI.Responses.ResponseInputItem)
      }
    }

    return { instructions, input }
  }

  mapTools(tools: ITool[]): OpenAI.Responses.Tool[] {
    return tools.map(t => ({
      type: 'function' as const,
      name: t.name,
      description: t.description,
      parameters: t.inputSchema as Record<string, unknown>,
      strict: null,
    }))
  }

  mapContentParts(parts: ContentPart[]): OpenAI.Responses.ResponseInputContent[] {
    return parts.map((part): OpenAI.Responses.ResponseInputContent => {
      if (part.type === 'text') return { type: 'input_text', text: part.text }
      if (part.type === 'image') {
        const url = part.source.type === 'base64' ? `data:${part.source.mediaType};base64,${part.source.data}` : part.source.url
        return { type: 'input_image', image_url: url, detail: 'auto' }
      }
      // Native file support — base64-encode if needed
      const data = typeof part.data === 'string' ? part.data : Buffer.from(part.data).toString('base64')
      return { type: 'input_file', file_data: `data:${part.mimeType};base64,${data}` }
    })
  }

  mapResponseToMessage(response: OpenAI.Responses.Response): IMessage {
    const result: IMessage = { role: 'assistant', content: response.output_text ?? '' }
    const toolCalls = response.output
      .filter((item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call')
      .map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments }))
    if (toolCalls.length) result.toolCalls = toolCalls
    return result
  }
}
