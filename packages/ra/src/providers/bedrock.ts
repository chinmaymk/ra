import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type ContentBlock,
  type Tool as BedrockTool,
  type ToolInputSchema,
  type ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime'
import { extractSystemMessages, mergeConsecutive, parseToolArguments, serializeContent, THINKING_BUDGETS, resolveThinkingBudget, DEFAULT_MAX_TOKENS, withDoneGuard } from './utils'
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
      inferenceConfig: { maxTokens: (request.providerOptions?.maxTokens as number) ?? DEFAULT_MAX_TOKENS },
      ...(request.thinking && {
        additionalModelRequestFields: {
          thinking: { type: 'enabled', budget_tokens: resolveThinkingBudget(THINKING_BUDGETS, request.thinking, request.thinkingBudgetCap) }
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

    yield* withDoneGuard(this.parseStream(response.stream))
  }

  private async *parseStream(stream: AsyncIterable<ConverseStreamOutput>): AsyncIterable<StreamChunk> {
    let usage: TokenUsage | undefined
    let currentToolCallId = ''

    for await (const event of stream) {
      if (event.contentBlockStart?.start?.toolUse) {
        const { toolUseId, name } = event.contentBlockStart.start.toolUse
        currentToolCallId = toolUseId ?? ''
        yield { type: 'tool_call_start', id: toolUseId ?? '', name: name ?? '' }
      } else if (event.contentBlockDelta?.delta?.text) {
        yield { type: 'text', delta: event.contentBlockDelta.delta.text }
      } else if (event.contentBlockDelta?.delta?.toolUse?.input) {
        yield { type: 'tool_call_delta', id: currentToolCallId, argsDelta: event.contentBlockDelta.delta.toolUse.input }
      } else if (event.contentBlockDelta?.delta?.reasoningContent?.text) {
        yield { type: 'thinking', delta: event.contentBlockDelta.delta.reasoningContent.text }
      } else if (event.contentBlockStop && currentToolCallId) {
        yield { type: 'tool_call_end', id: currentToolCallId }
        currentToolCallId = ''
      } else if (event.metadata?.usage) {
        usage = { inputTokens: event.metadata.usage.inputTokens ?? 0, outputTokens: event.metadata.usage.outputTokens ?? 0 }
      } else if (event.messageStop) {
        yield { type: 'done', usage }
      }
    }
  }

  mapMessages(messages: IMessage[]): BedrockMessage[] {
    const mapped = messages.map((msg): BedrockMessage => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [{ toolResult: { toolUseId: msg.toolCallId ?? '', content: [{ text: serializeContent(msg.content) }] } }],
        }
      }
      if (msg.role === 'assistant' && msg.toolCalls?.length) {
        const content: ContentBlock[] = []
        if (typeof msg.content === 'string' && msg.content) content.push({ text: msg.content })
        else if (Array.isArray(msg.content)) content.push(...this.mapContentParts(msg.content))
        for (const tc of msg.toolCalls) {
          content.push({ toolUse: { toolUseId: tc.id, name: tc.name, input: parseToolArguments(tc.arguments) as unknown as Record<string, never> } })
        }
        return { role: 'assistant', content }
      }
      // user or assistant without tool calls
      const role = msg.role as 'user' | 'assistant'
      return typeof msg.content === 'string'
        ? { role, content: [{ text: msg.content }] }
        : { role, content: this.mapContentParts(msg.content) }
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

  private static toBedrockImageFormat(mediaType: string): 'jpeg' | 'png' | 'gif' | 'webp' {
    const sub = mediaType.split('/')[1] ?? 'jpeg'
    return (sub === 'jpg' ? 'jpeg' : sub) as 'jpeg' | 'png' | 'gif' | 'webp'
  }

  mapContentParts(parts: ContentPart[]): ContentBlock[] {
    return parts.map((part): ContentBlock => {
      if (part.type === 'text') return { text: part.text }
      if (part.type === 'image') {
        const src = part.source
        if (src.type === 'base64') {
          return {
            image: {
              format: BedrockProvider.toBedrockImageFormat(src.mediaType),
              source: { bytes: Buffer.from(src.data, 'base64') },
            },
          }
        }
        return { text: `[Image: ${src.url}]` }
      }
      return { text: `[File: ${part.mimeType}]` }
    })
  }

  mapResponseToMessage(message?: BedrockMessage): IMessage {
    const toolCalls: IToolCall[] = []
    let textContent = ''
    for (const block of message?.content ?? []) {
      if (block.text) textContent += block.text
      else if (block.toolUse) toolCalls.push({ id: block.toolUse.toolUseId ?? '', name: block.toolUse.name ?? '', arguments: JSON.stringify(block.toolUse.input) })
    }
    return { role: 'assistant', content: textContent, ...(toolCalls.length && { toolCalls }) }
  }
}
