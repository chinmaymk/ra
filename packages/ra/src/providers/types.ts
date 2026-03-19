export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'file'; mimeType: string; data: Uint8Array | Buffer | string }

export type ImageSource =
  | { type: 'base64'; mediaType: string; data: string }
  | { type: 'url'; url: string }

export interface IMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string | ContentPart[]
  toolCallId?: string
  toolCalls?: IToolCall[]
  isError?: boolean
}

export interface IToolCall {
  id: string
  name: string
  arguments: string
}

export interface IToolResult {
  toolCallId: string
  content: string | ContentPart[]
  isError?: boolean
}

export interface ITool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute(input: unknown): Promise<unknown>
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  thinkingTokens?: number
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'done'; usage?: TokenUsage }

export interface ChatRequest {
  model: string
  messages: IMessage[]
  tools?: ITool[]
  thinking?: 'low' | 'medium' | 'high'
  providerOptions?: Record<string, unknown>
  signal?: AbortSignal
}

export interface ChatResponse {
  message: IMessage
  usage?: TokenUsage
}

export interface IProvider {
  name: string
  chat(request: ChatRequest): Promise<ChatResponse>
  stream(request: ChatRequest): AsyncIterable<StreamChunk>
}

export type ProviderName = 'anthropic' | 'openai' | 'openai-completions' | 'google' | 'ollama' | 'bedrock' | 'azure'
