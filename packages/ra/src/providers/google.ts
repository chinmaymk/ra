import { GoogleGenerativeAI, type Content, type Part, type Tool as GeminiTool, type GenerateContentResponse } from '@google/generative-ai'
import { extractSystemMessages, mergeConsecutive, parseToolArguments, serializeContent } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, ContentPart, TokenUsage, ThinkingLevel } from './types'

const THINKING_BUDGETS_GOOGLE = { low: 1024, medium: 8192, high: 24576 } as const

/** Check if a Gemini part is a thinking/thought block (not in official types yet). */
function isThoughtPart(part: Record<string, unknown>): boolean {
  return 'thought' in part && !!part.thought
}

/** Separator for synthetic tool call IDs: `counter::name`. Using `::` avoids collisions with tool names that contain `_` or `-`. */
const TOOL_ID_SEP = '::'

function makeToolCallId(counter: number, name: string): string {
  return `${counter}${TOOL_ID_SEP}${name}`
}

function parseToolCallId(id: string): string {
  const sepIdx = id.indexOf(TOOL_ID_SEP)
  return sepIdx >= 0 ? id.slice(sepIdx + TOOL_ID_SEP.length) : id
}

export interface GoogleProviderOptions {
  apiKey: string
  baseURL?: string
}

export class GoogleProvider implements IProvider {
  readonly name = 'google'
  private client: GoogleGenerativeAI
  private baseURL?: string

  constructor(options: GoogleProviderOptions) {
    this.client = new GoogleGenerativeAI(options.apiKey)
    this.baseURL = options.baseURL
  }

  private buildModel(request: ChatRequest) {
    const { system, filtered } = extractSystemMessages(request.messages)
    const requestOptions = this.baseURL ? { baseUrl: this.baseURL } : undefined
    const model = this.client.getGenerativeModel({ model: request.model, ...(system && { systemInstruction: system }) }, requestOptions)
    // Filter out messages with empty parts to avoid Gemini API rejection
    const contents = this.mapMessages(filtered).filter(c => c.parts.length > 0)
    const tools = request.tools?.length ? this.mapTools(request.tools) : undefined
    return { model, contents, tools }
  }

  private toUsage(meta: { promptTokenCount?: number; candidatesTokenCount?: number }): TokenUsage {
    return { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 }
  }

  private buildGenerationConfig(thinking?: ThinkingLevel, budgetCap?: number): Record<string, unknown> | undefined {
    if (!thinking) return undefined
    const base = THINKING_BUDGETS_GOOGLE[thinking]
    const budget = budgetCap ? Math.min(base, budgetCap) : base
    return { thinkingConfig: { thinkingBudget: budget } }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const { model, contents, tools } = this.buildModel(request)
    const generationConfig = this.buildGenerationConfig(request.thinking, request.thinkingBudgetCap)
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
    const generationConfig = this.buildGenerationConfig(request.thinking, request.thinkingBudgetCap)
    const result = await model.generateContentStream(
      {
        contents,
        ...(tools && { tools }),
        ...(generationConfig && { generationConfig }),
      },
      ...(request.signal ? [{ signal: request.signal }] : []),
    )
    let usage: TokenUsage | undefined
    let toolCallCounter = 0

    for await (const chunk of result.stream) {
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        if (isThoughtPart(part as unknown as Record<string, unknown>) && 'text' in part && part.text) {
          yield { type: 'thinking', delta: part.text }
        } else if ('text' in part && part.text) {
          yield { type: 'text', delta: part.text }
        } else if ('functionCall' in part && part.functionCall) {
          const { name, args } = part.functionCall
          const id = makeToolCallId(toolCallCounter++, name)
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
    const mapped = messages.map((msg): Content => {
      if (msg.role === 'tool') {
        const toolName = parseToolCallId(msg.toolCallId ?? '')
        return {
          role: 'user',
          parts: [{ functionResponse: { name: toolName, response: { content: serializeContent(msg.content) } } }],
        }
      }
      const role = msg.role === 'assistant' ? 'model' : 'user'
      const parts: Part[] = []
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        if (typeof msg.content === 'string' && msg.content) parts.push({ text: msg.content })
        else if (Array.isArray(msg.content)) parts.push(...this.mapContentParts(msg.content))
        for (const tc of msg.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: parseToolArguments(tc.arguments) } })
        }
      } else if (typeof msg.content === 'string') {
        if (msg.content) parts.push({ text: msg.content })
      } else {
        parts.push(...this.mapContentParts(msg.content))
      }
      return { role, parts }
    })
    // Merge consecutive same-role messages (required for alternating-turn APIs)
    return mergeConsecutive(mapped, (a, b) => { a.parts = a.parts.concat(b.parts) })
  }

  mapTools(tools: ITool[]): GeminiTool[] {
    return [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: t.inputSchema as unknown as import('@google/generative-ai').FunctionDeclarationSchema })) }]
  }

  mapContentParts(parts: ContentPart[]): Part[] {
    return parts.map((part): Part => {
      if (part.type === 'text') return { text: part.text }
      if (part.type === 'image') {
        const src = part.source
        if (src.type === 'base64') return { inlineData: { mimeType: src.mediaType, data: src.data } }
        const ext = src.url.match(/\.(png|gif|webp|svg)$/)?.[1]
        const mimeType = ext === 'svg' ? 'image/svg+xml' : ext ? `image/${ext}` : 'image/jpeg'
        return { fileData: { mimeType, fileUri: src.url } }
      }
      return { inlineData: { mimeType: part.mimeType, data: typeof part.data === 'string' ? part.data : Buffer.from(part.data).toString('base64') } }
    })
  }

  mapResponseToMessage(response: GenerateContentResponse): IMessage {
    const toolCalls: IToolCall[] = []
    let textContent = ''
    let counter = 0
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (isThoughtPart(part as unknown as Record<string, unknown>)) continue
      if ('text' in part && part.text) textContent += part.text
      else if ('functionCall' in part && part.functionCall) {
        const { name, args } = part.functionCall
        toolCalls.push({ id: makeToolCallId(counter++, name), name, arguments: JSON.stringify(args ?? {}) })
      }
    }
    return { role: 'assistant', content: textContent, ...(toolCalls.length && { toolCalls }) }
  }
}
