import { Ollama, type ChatRequest as OllamaChatRequest, type Message as OllamaMessage, type Tool as OllamaTool, type ToolCall as OllamaToolCall } from 'ollama'
import { contentToString, parseToolArguments } from './utils'
import type { IProvider, IMessage, ITool, ChatRequest, ChatResponse, StreamChunk } from './types'

export interface OllamaProviderOptions {
  host?: string
}

export class OllamaProvider implements IProvider {
  name = 'ollama'
  private client: Ollama

  constructor(options: OllamaProviderOptions = {}) {
    this.client = new Ollama({ host: options.host })
  }

  buildParams(request: ChatRequest): Omit<OllamaChatRequest, 'stream'> {
    const params: Omit<OllamaChatRequest, 'stream'> = {
      model: request.model,
      messages: this.mapMessages(request.messages),
    }
    if (request.tools?.length) params.tools = this.mapTools(request.tools)
    if (request.providerOptions) Object.assign(params as unknown as Record<string, unknown>, request.providerOptions)
    return params
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.chat({ ...this.buildParams(request), stream: false })
    return { message: this.mapResponseToMessage(response.message) }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const stream = await this.client.chat({ ...this.buildParams(request), stream: true })
    let toolCallIndex = 0
    let emittedDone = false

    for await (const chunk of stream) {
      const msg = chunk.message
      if (!msg) continue
      if (msg.content) yield { type: 'text', delta: msg.content }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const id = `call_${toolCallIndex++}`
          yield { type: 'tool_call_start', id, name: tc.function?.name ?? '' }
          yield { type: 'tool_call_delta', id, argsDelta: JSON.stringify(tc.function?.arguments ?? {}) }
          yield { type: 'tool_call_end', id }
        }
      }
      if (chunk.done) {
        const usage = chunk.prompt_eval_count != null && chunk.eval_count != null
          ? { inputTokens: chunk.prompt_eval_count, outputTokens: chunk.eval_count }
          : undefined
        emittedDone = true
        yield { type: 'done', usage }
      }
    }
    if (!emittedDone) yield { type: 'done' }
  }

  mapMessages(messages: IMessage[]): OllamaMessage[] {
    return messages.map((msg): OllamaMessage => {
      if (msg.role === 'system') {
        return { role: 'system', content: contentToString(msg.content) }
      }
      if (msg.role === 'tool') {
        return { role: 'tool', content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) }
      }
      if (msg.role === 'assistant') {
        const result: OllamaMessage = { role: 'assistant', content: contentToString(msg.content) }
        if (msg.toolCalls?.length) {
          result.tool_calls = msg.toolCalls.map((tc): OllamaToolCall => ({
            function: { name: tc.name, arguments: parseToolArguments(tc.arguments) }
          }))
        }
        return result
      }
      return { role: 'user', content: contentToString(msg.content) }
    })
  }

  mapTools(tools: ITool[]): OllamaTool[] {
    return tools.map(t => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema as OllamaTool['function']['parameters'] } }))
  }

  mapResponseToMessage(msg: OllamaMessage): IMessage {
    const result: IMessage = { role: 'assistant', content: msg.content ?? '' }
    if (msg.tool_calls?.length) {
      result.toolCalls = msg.tool_calls.map((tc, i) => ({ id: `call_${i}`, name: tc.function.name ?? '', arguments: JSON.stringify(tc.function.arguments) }))
    }
    return result
  }
}
