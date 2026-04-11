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
  /** Internal tracking ID for session persistence. Survives object replacement (spread). */
  _messageId?: string
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
  /** Per-tool timeout in ms. Overrides the global toolTimeout when set. */
  timeout?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  thinkingTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export type StreamChunk =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'done'; usage?: TokenUsage }

/** Resolved thinking level sent to providers. */
export type ThinkingLevel = 'low' | 'medium' | 'high'

/** Thinking mode: off (disabled), a fixed level, or adaptive (high→low after 5 turns). */
export type ThinkingMode = 'off' | ThinkingLevel | 'adaptive'

export interface ChatRequest {
  model: string
  messages: IMessage[]
  tools?: ITool[]
  thinking?: ThinkingLevel
  /** Absolute cap on thinking budget tokens. When set, the provider uses min(levelBudget, cap). */
  thinkingBudgetCap?: number
  providerOptions?: Record<string, unknown>
  signal?: AbortSignal
  /**
   * Identifier of the ra session driving this request. Stateless providers
   * ignore it; stateful providers (e.g. anthropic-agents-sdk, whose subprocess
   * is 1:1 with a session) may use it as a stable UUID for CC session
   * resumption so history survives subprocess rebuilds and ra restarts.
   */
  sessionId?: string
}

export interface ChatResponse {
  message: IMessage
  usage?: TokenUsage
}

export interface IProvider {
  name: string
  chat(request: ChatRequest): Promise<ChatResponse>
  stream(request: ChatRequest): AsyncIterable<StreamChunk>
  /**
   * When true, the provider manages its own context window internally
   * (e.g. the Claude CLI subprocess compacts on its own). ra's AgentLoop
   * will skip installing its compaction middleware and error-recovery
   * path for this provider.
   */
  readonly autoContextManaged?: boolean
}

export type ProviderName =
  | 'anthropic'
  | 'openai'
  | 'openai-completions'
  | 'google'
  | 'ollama'
  | 'bedrock'
  | 'azure'
  | 'codex'
  | 'anthropic-agents-sdk'
