/**
 * Container entry point — runs inside a Docker container.
 *
 * Reads SandboxCommands from stdin (NDJSON), writes SandboxEvents to stdout.
 * Reconstructs provider, tools, and middleware from SandboxConfig.
 */
import {
  AgentLoop,
  ToolRegistry,
  createProvider,
  buildProviderConfig,
  type IMessage,
  type ProviderName,
  type AgentLoopOptions,
  type StreamChunkContext,
  type Logger,
  type LogLevel,
} from '@chinmaymk/ra'
import { registerBuiltinTools } from '../tools'
import { loadMiddleware } from '../middleware/loader'
import { createPermissionsMiddleware } from '../agent/permissions'
import type { RaConfig } from '../config/types'
import type { SandboxCommand, SandboxConfig, SandboxEvent } from './types'

// ── Logging via stdout events ───────────────────────────────────────

class SandboxLogger implements Logger {
  readonly level: LogLevel = 'info'

  private emit(level: string, message: string, data?: Record<string, unknown>) {
    send({ type: 'log', level, message, data })
  }

  debug(message: string, data?: Record<string, unknown>) { this.emit('debug', message, data) }
  info(message: string, data?: Record<string, unknown>) { this.emit('info', message, data) }
  warn(message: string, data?: Record<string, unknown>) { this.emit('warn', message, data) }
  error(message: string, data?: Record<string, unknown>) { this.emit('error', message, data) }
  async flush() { /* noop — stdout is unbuffered */ }
}

// ── Wire protocol ───────────────────────────────────────────────────

function send(event: SandboxEvent) {
  process.stdout.write(JSON.stringify(event) + '\n')
}

// ── State ───────────────────────────────────────────────────────────

let savedOptions: AgentLoopOptions | undefined
const activeLoops = new Map<string, AgentLoop>()
const logger: Logger = new SandboxLogger()

// ── Command handlers ────────────────────────────────────────────────

async function handleInit(config: SandboxConfig) {
  const provider = createProvider(
    buildProviderConfig(config.provider as ProviderName, config.providerOptions),
  )

  const tools = new ToolRegistry()
  if (config.tools.builtin || Object.keys(config.tools.overrides).length > 0) {
    registerBuiltinTools(tools, config.tools)
  }

  // Reconstruct middleware from file paths / inline expressions
  const fakeConfig = {
    agent: { middleware: config.middleware },
  } as RaConfig
  const middleware = await loadMiddleware(fakeConfig, config.configDir, logger)

  // Permissions middleware
  if (config.permissions.rules?.length && !config.permissions.no_rules_rules) {
    const permMw = createPermissionsMiddleware(config.permissions)
    middleware.beforeToolExecution = [permMw, ...(middleware.beforeToolExecution ?? [])]
  }

  savedOptions = {
    provider,
    tools,
    model: config.model,
    maxIterations: config.maxIterations,
    maxRetries: config.maxRetries,
    toolTimeout: config.toolTimeout,
    parallelToolCalls: config.parallelToolCalls,
    maxTokenBudget: config.maxTokenBudget,
    maxDuration: config.maxDuration,
    maxToolResponseSize: config.maxToolResponseSize,
    thinking: config.thinking,
    thinkingBudgetCap: config.thinkingBudgetCap,
    compaction: config.compaction,
    middleware,
    logger,
  }

  send({ type: 'ready' })
}

async function handleRun(id: string, messages: IMessage[]) {
  if (!savedOptions) {
    send({ type: 'error', id, error: 'Sandbox not initialized. Send init command first.' })
    return
  }

  // Install a stream-forwarding middleware for this run
  const onStreamChunk = async (ctx: StreamChunkContext) => {
    send({ type: 'chunk', id, chunk: ctx.chunk })
  }

  const existingOnChunk = savedOptions.middleware?.onStreamChunk ?? []
  const loopMiddleware = {
    ...savedOptions.middleware,
    onStreamChunk: [onStreamChunk, ...existingOnChunk],
  }

  const loop = new AgentLoop({
    ...savedOptions,
    middleware: loopMiddleware,
  })
  activeLoops.set(id, loop)

  try {
    const result = await loop.run(messages)
    send({
      type: 'result',
      id,
      result: {
        messages: result.messages,
        iterations: result.iterations,
        usage: result.usage,
        durationMs: result.durationMs,
        stopReason: result.stopReason,
      },
    })
  } catch (err) {
    send({ type: 'error', id, error: err instanceof Error ? err.message : String(err) })
  } finally {
    activeLoops.delete(id)
  }
}

function handleAbort(id: string) {
  const loop = activeLoops.get(id)
  if (loop) loop.abort()
}

// ── Main loop: read NDJSON from stdin ───────────────────────────────

async function main() {
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let cmd: SandboxCommand
      try {
        cmd = JSON.parse(trimmed) as SandboxCommand
      } catch {
        send({ type: 'log', level: 'error', message: 'invalid command', data: { line: trimmed } })
        continue
      }

      switch (cmd.type) {
        case 'init':
          await handleInit(cmd.config)
          break
        case 'run':
          // Don't await — allow abort commands to arrive during execution
          handleRun(cmd.id, cmd.messages)
          break
        case 'abort':
          handleAbort(cmd.id)
          break
      }
    }
  }
}

main().catch((err) => {
  send({ type: 'log', level: 'error', message: 'sandbox entry crashed', data: { error: String(err) } })
  process.exit(1)
})
