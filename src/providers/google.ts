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
    let toolCallCounter = 0

    for await (const chunk of result.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if ('thought' in part && (part as any).thought && 'text' in part && part.text) {
          yield { type: 'thinking', delta: part.text }
        } else if ('text' in part && part.text) {
          yield { type: 'text', delta: part.text }
        } else if ('functionCall' in part && part.functionCall) {
          const { name, args } = part.functionCall
          const id = `${name}_${toolCallCounter++}`
          yield { type: 'tool_call_start', id, name }
          yield { type: 'tool_call_delta', id, argsDelta: JSON.stringify(args ?? {}) }
          yield { type: 'tool_call_end', id }
        }
      }
      if (chunk.usageMetadata) usage = this.toUsage(chunk.usageMetadata)
    }

    yield { type: 'done', usage }
  }

  mapMessages(messages: IMessage[]): Content[] {
    return messages.map((msg): Content => {
      if (msg.role === 'tool') {
        // toolCallId is formatted as "functionName_counter" — extract the function name for Gemini
        const toolName = msg.toolCallId!.substring(0, msg.toolCallId!.lastIndexOf('_'))
        return {
          role: 'user',
          parts: [{ functionResponse: { name: toolName, response: { content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content) } } }],
        }
      }
      const role = msg.role === 'assistant' ? 'model' : 'user'
      const parts: Part[] = []
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        if (typeof msg.content === 'string' && msg.content) parts.push({ text: msg.content })
        else if (Array.isArray(msg.content)) parts.push(...this.mapContentParts(msg.content))
        for (const tc of msg.toolCalls) {
          let args: Record<string, unknown>
          try { args = JSON.parse(tc.arguments) } catch { args = {} }
          parts.push({ functionCall: { name: tc.name, args } })
        }
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
        return src.type === 'base64' ? { inlineData: { mimeType: src.mediaType, data: src.data } } : { fileData: { mimeType: this.inferMimeType(src.url), fileUri: src.url } }
      }
      return { inlineData: { mimeType: part.mimeType, data: typeof part.data === 'string' ? part.data : Buffer.from(part.data).toString('base64') } }
    })
  }

  private inferMimeType(url: string): string {
    if (url.endsWith('.png')) return 'image/png'
    if (url.endsWith('.gif')) return 'image/gif'
    if (url.endsWith('.webp')) return 'image/webp'
    if (url.endsWith('.svg')) return 'image/svg+xml'
    return 'image/jpeg'
  }

  mapResponseToMessage(response: GenerateContentResponse): IMessage {
    const toolCalls: IToolCall[] = []
    let textContent = ''
    let counter = 0
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if ('thought' in part && (part as any).thought) continue
      if ('text' in part && part.text) textContent += part.text
      else if ('functionCall' in part && part.functionCall) {
        const { name, args } = part.functionCall
        toolCalls.push({ id: `${name}_${counter++}`, name, arguments: JSON.stringify(args ?? {}) })
      }
    }
    return { role: 'assistant', content: textContent, ...(toolCalls.length && { toolCalls }) }
  }
}
