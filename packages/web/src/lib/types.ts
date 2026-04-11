export type SessionStatus = 'idle' | 'running' | 'needs-input' | 'error' | 'done'

export interface SessionInfo {
  id: string
  name: string
  status: SessionStatus
  provider: string
  model: string
  createdAt: string
  worktree?: { path: string; branch: string }
  iteration: number
  tokenUsage: TokenUsage
  currentTool?: string
  lastAssistantMessage?: string
  errorMessage?: string
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  thinkingTokens: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
  result?: string
  isError?: boolean
  durationMs?: number
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string } }
  | { type: 'file'; mimeType: string; data: string }

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | ContentPart[]
  toolCalls?: ToolCall[]
  toolCallId?: string
  isError?: boolean
  thinking?: string
}

export type SessionEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; argsDelta: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean }
  | { type: 'status'; status: SessionStatus; name?: string }
  | { type: 'stats'; usage: TokenUsage; iteration: number; currentTool?: string }
  | { type: 'snapshot'; text: string; thinking: string; toolCalls: ToolCall[] }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; error: string }

export interface CreateSessionOptions {
  worktree?: boolean
  branch?: string
  provider?: string
  model?: string
  thinking?: 'off' | 'low' | 'medium' | 'high'
  attachments?: ImageAttachment[]
}

export interface ImageAttachment {
  /** Base64-encoded image data (no data URI prefix) */
  data: string
  /** MIME type (e.g. 'image/png', 'image/jpeg') */
  mimeType: string
  /** Optional filename for display */
  name?: string
}

export interface ToolInfo {
  name: string
  description: string
  schema?: Record<string, unknown>
  source: 'builtin' | 'custom' | 'mcp'
  enabled: boolean
}

export interface MiddlewareInfo {
  hook: string
  names: string[]
}

export interface ModelInfo {
  name: string
  inputTokenCostPer1M?: number
  outputTokenCostPer1M?: number
}

export interface ProviderInfo {
  name: string
  models: ModelInfo[]
  hasCredentials: boolean
}

export interface KnowledgeBase {
  id: string
  name: string
  description: string
  documentCount: number
  totalTokens: number
  embedding: string
  createdAt: string
  updatedAt: string
}

export interface KnowledgeDocument {
  id: string
  knowledgeBaseId: string
  filename: string
  mimeType: string
  tokenCount: number
  status: 'processing' | 'ready' | 'error'
  createdAt: string
}

export interface ConfigSummary {
  provider: string
  model: string
  thinking?: string
  systemPrompt: string
  maxIterations: number
  toolTimeout: number
  parallelToolCalls: boolean
  raw: Record<string, unknown>
}
