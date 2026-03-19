import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type ContentBlock,
  type Tool as BedrockTool,
  type ToolInputSchema,
} from '@aws-sdk/client-bedrock-runtime'
import { extractSystemMessages, mergeConsecutive, parseToolArguments, serializeContent, THINKING_BUDGETS } from './utils'
import type { IProvider, ChatRequest, ChatResponse, StreamChunk, IMessage, ITool, IToolCall, ContentPart, TokenUsage } from './types'


export interface BedrockProviderOptions {
  region?: string
  apiKey?: string
}

export class BedrockProvider implements IProvider {
  readonly name = 'bedrock'
  private client: BedrockRuntimeClient

  constructor(options: BedrockProviderOptions) {
    this.client = new BedrockRuntimeClient({
      region: options.region ?? 'us-east-1',
      ...(options.apiKey && { token: { token: options.apiKey } }),
    })
  }

  buildParams(request: ChatRequest) {
    const { system, filtered } = extractSystemMessages(request.messages)
    return {
      modelId: request.model,
      messages: this.mapMessages(filtered),
      ...(system && { system: [{ text: system }] }),
      ...(request.tools?.length && { toolConfig: { tools: this.mapTools(request.tools) } }),
      inferenceConfig: { maxTokens: (request.providerOptions?.maxTokens as number) ?? 4096 },
      ...(request.thinking && {
        additionalModelRequestFields: {
          thinking: { type: 'enabled', budget_tokens: THINKING_BUDGETS[request.thinking] }
        }
      }),
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await this.client.send(new ConverseCommand(this.buildParams(request)))
    const usage: TokenUsage = {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    }
    return { message: this.mapResponseToMessage(response.output?.message), usage }
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const response = await this.client.send(
      new ConverseStreamCommand(this.buildParams(request)),
      ...(request.signal ? [{ abortSignal: request.signal }] : []),
    )
    if (!response.stream) return

    let usage: TokenUsage | undefined
    let currentToolCallId = ''
    let emittedDone = false

    for await (const event of response.stream) {
      if (event.contentBlockStart?.start?.toolUse) {
        const { toolUseId, name } = event.contentBlockStart.start.toolUse
        currentToolCallId = toolUseId!
        yield { type: 'tool_call_start', id: toolUseId!, name: name! }
      } else if (event.contentBlockDelta?.delta?.text) {
        yield { type: 'text', delta: event.contentBlockDelta.delta.text }
      } else if (event.contentBlockDelta?.delta?.toolUse?.input) {
        yield { type: 'tool_call_delta', id: currentToolCallId, argsDelta: event.contentBlockDelta.delta.toolUse.input }
      } else if (event.metadata?.usage) {
        usage = { inputTokens: event.metadata.usage.inputTokens ?? 0, outputTokens: event.metadata.usage.outputTokens ?? 0 }
      } else if (event.messageStop) {
        emittedDone = true
        yield { type: 'done', usage }
      }
    }
    if (!emittedDone) yield { type: 'done', usage }
  }

  mapMessages(messages: IMessage[]): BedrockMessage[] {
    const mapped = messages.map((msg): BedrockMessage => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{ toolResult: { toolUseId: msg.toolCallId!, content: [{ text: serializeContent(msg.content) }] } }],
        }
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: ContentBlock[] = []
        if (typeof msg.content === 'string' && msg.content) content.push({ text: msg.content })
        else if (Array.isArray(msg.content)) content.push(...this.mapContentParts(msg.content))
        for (const tc of msg.toolCalls) {
          content.push({ toolUse: { toolUseId: tc.id, name: tc.name, input: parseToolArguments(tc.arguments) as any } })
        }
        return { role: 'assistant', content }
      }
      if (typeof msg.content === 'string') return { role: msg.role as 'user' | 'assistant', content: [{ text: msg.content }] }
      return { role: msg.role as 'user' | 'assistant', content: this.mapContentParts(msg.content) }
    })
    // Merge consecutive same-role messages (required for alternating-turn APIs)
    return mergeConsecutive(mapped, (a, b) => { a.content = (a.content ?? []).concat(b.content ?? []) })
  }

  mapTools(tools: ITool[]): BedrockTool[] {
    return tools.map(t => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: t.inputSchema } as ToolInputSchema,
      },
    }))
  }

  mapContentParts(parts: ContentPart[]): ContentBlock[] {
    return parts.map((part): ContentBlock => {
      if (part.type === 'text') return { text: part.text }
      if (part.type === 'image') {
        const src = part.source
        if (src.type === 'base64') {
          return {
            image: {
              format: (src.mediaType.split('/')[1] === 'jpg' ? 'jpeg' : src.mediaType.split('/')[1]) as 'jpeg' | 'png' | 'gif' | 'webp',
              source: { bytes: Buffer.from(src.data, 'base64') },
            },
          }
        }
        // URL images not natively supported by Bedrock — fall back to text
        return { text: `[Image: ${src.url}]` }
      }
      // file/document
      return { text: `[File: ${part.mimeType}]` }
    })
  }

  mapResponseToMessage(message?: BedrockMessage): IMessage {
    const toolCalls: IToolCall[] = []
    let textContent = ''
    for (const block of message?.content ?? []) {
      if (block.text) textContent += block.text
      else if (block.toolUse) toolCalls.push({ id: block.toolUse.toolUseId!, name: block.toolUse.name!, arguments: JSON.stringify(block.toolUse.input) })
    }
    return { role: 'assistant', content: textContent, ...(toolCalls.length && { toolCalls }) }
  }
}
