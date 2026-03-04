import { GoogleGenerativeAI } from '@google/generative-ai'
import type { Content, Part, Tool as GeminiTool, GenerateContentResponse } from '@google/generative-ai'
import { extractSystemMessages } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, ContentPart, TokenUsage } from './types'

const THINKING_BUDGETS_GOOGLE = { low: 512, medium: 4096, high: 16384 } as const

export interface GoogleProviderOptions {
  apiKey: string
}

export class GoogleProvider implements IProvider {
  readonly name = 'google'
  private client: GoogleGenerativeAI

  constructor(options: GoogleProviderOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey)
  }

  private buildModel(request: ChatRequest) {
    const { system, filtered } = extractSystemMessages(request.messages)
    const model = this.client.getGenerativeModel({ model: request.model, ...(system && { systemInstruction: system }) })
    const contents = this.mapMessages(filtered)
    const tools = request.tools?.length ? this.mapTools(request.tools) : undefined
    return { model, contents, tools }
  }

  private toUsage(meta: { promptTokenCount?: number; candidatesTokenCount?: number }): TokenUsage {
    return { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 }
  }

  private buildThinkingConfig(thinking?: 'low' | 'medium' | 'high') {
    if (!thinking) return undefined
    return { thinkingBudget: THINKING_BUDGETS_GOOGLE[thinking] }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { model, contents, tools } = this.buildModel(request)
    const thinkingConfig = this.buildThinkingConfig(request.thinking)
    const generationConfig = thinkingConfig ? { thinkingConfig } as any : undefined
    const result = await model.generateContent({
      contents,
      ...(tools && { tools }),
      ...(generationConfig && { generationConfig }),
    })
    return {
      message: this.mapResponseToMessage(result.response),
      usage: result.response.usageMetadata ? this.toUsage(result.response.usageMetadata) : undefined,
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const { model, contents, tools } = this.buildModel(request)
    const thinkingConfig = this.buildThinkingConfig(request.thinking)
    const generationConfig = thinkingConfig ? { thinkingConfig } as any : undefined
    const result = await model.generateContentStream({
      contents,
      ...(tools && { tools }),
      ...(generationConfig && { generationConfig }),
    })
    let usage: TokenUsage | undefined

    for await (const chunk of result.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if ('thought' in part && (part as any).thought && 'text' in part && part.text) {
          yield { type: 'thinking', delta: part.text }
        } else if ('text' in part && part.text) {
          yield { type: 'text', delta: part.text }
        } else if ('functionCall' in part && part.functionCall) {
          const { name, args } = part.functionCall
          yield { type: 'tool_call_start', id: name, name }
          yield { type: 'tool_call_delta', id: name, argsDelta: JSON.stringify(args ?? {}) }
          yield { type: 'tool_call_end', id: name }
        }
      }
      if (chunk.usageMetadata) usage = this.toUsage(chunk.usageMetadata)
    }

    yield { type: 'done', usage }
  }

  mapMessages(messages: IMessage[]): Content[] {
    return messages.map((msg): Content => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          parts: [{ functionResponse: { name: msg.toolCallId!, response: { content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) } } }],
        }
      }
      const role = msg.role === 'assistant' ? 'model' : 'user'
      const parts: Part[] = []
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        if (typeof msg.content === 'string' && msg.content) parts.push({ text: msg.content })
        else if (Array.isArray(msg.content)) parts.push(...this.mapContentParts(msg.content))
        for (const tc of msg.toolCalls) parts.push({ functionCall: { name: tc.name, args: JSON.parse(tc.arguments) } })
      } else if (typeof msg.content === 'string') {
        parts.push({ text: msg.content })
      } else {
        parts.push(...this.mapContentParts(msg.content))
      }
      return { role, parts }
    })
  }

  mapTools(tools: ITool[]): GeminiTool[] {
    return [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema as unknown as import('@google/generative-ai').FunctionDeclarationSchema })) }]
  }

  mapContentParts(parts: ContentPart[]): Part[] {
    return parts.map((part): Part => {
      if (part.type === 'text') return { text: part.text }
      if (part.type === 'image') {
        const src = part.source
        return src.type === 'base64' ? { inlineData: { mimeType: src.mediaType, data: src.data } } : { fileData: { mimeType: 'image/jpeg', fileUri: src.url } }
      }
      return { inlineData: { mimeType: part.mimeType, data: typeof part.data === 'string' ? part.data : Buffer.from(part.data).toString('base64') } }
    })
  }

  mapResponseToMessage(response: GenerateContentResponse): IMessage {
    const toolCalls: IToolCall[] = []
    let textContent = ''
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if ('text' in part && part.text) textContent += part.text
      else if ('functionCall' in part && part.functionCall) {
        const { name, args } = part.functionCall
        toolCalls.push({ id: name, name, arguments: JSON.stringify(args ?? {}) })
      }
    }
    return { role: 'assistant', content: textContent, ...(toolCalls.length && { toolCalls }) }
  }
}
