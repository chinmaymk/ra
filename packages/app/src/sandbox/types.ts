import type {
  IMessage,
  StreamChunk,
  TokenUsage,
  ThinkingMode,
} from '@chinmaymk/ra'
import type { ToolsConfig, PermissionsConfig } from '../config/types'

// ── Serializable config sent to the container ───────────────────────

export interface SandboxConfig {
  provider: string
  providerOptions: Record<string, unknown>
  model: string
  systemPrompt?: string
  maxIterations: number
  maxRetries: number
  toolTimeout: number
  parallelToolCalls: boolean
  maxTokenBudget: number
  maxDuration: number
  maxToolResponseSize: number
  thinking?: ThinkingMode
  thinkingBudgetCap?: number
  compaction: {
    enabled: boolean
    threshold: number
    strategy?: 'truncate' | 'summarize'
    maxTokens?: number
    contextWindow?: number
    model?: string
    prompt?: string
  }
  tools: ToolsConfig
  permissions: PermissionsConfig
  middleware: Record<string, string[]>
  /** Directory for resolving middleware file paths (inside the container). */
  configDir: string
}

// ── Wire protocol (NDJSON over stdio) ───────────────────────────────

/** Main thread → Container (written to stdin). */
export type SandboxCommand =
  | { type: 'init'; config: SandboxConfig }
  | { type: 'run'; id: string; messages: IMessage[] }
  | { type: 'abort'; id: string }

/** Container → Main thread (read from stdout). */
export type SandboxEvent =
  | { type: 'ready' }
  | { type: 'chunk'; id: string; chunk: StreamChunk }
  | { type: 'result'; id: string; result: SandboxLoopResult }
  | { type: 'error'; id: string; error: string }
  | { type: 'log'; level: string; message: string; data?: Record<string, unknown> }

export interface SandboxLoopResult {
  messages: IMessage[]
  iterations: number
  usage: TokenUsage
  durationMs: number
  stopReason?: string
}

// ── Docker options ──────────────────────────────────────────────────

export interface SandboxOptions {
  /** Docker image name. Defaults to 'ra-sandbox'. */
  image?: string
  /** Memory limit (e.g. '512m', '1g'). */
  memory?: string
  /** CPU quota (e.g. '0.5' for half a core). */
  cpus?: string
  /** Network mode. Defaults to 'none' (fully isolated). */
  network?: 'none' | 'host' | 'bridge' | string
  /** Extra docker run flags (e.g. ['--read-only']). */
  extraFlags?: string[]
  /** Timeout in ms for the init phase. Default 30000. */
  initTimeout?: number
  /** Volumes to bind-mount (e.g. ['/host/path:/container/path:ro']). */
  volumes?: string[]
}
