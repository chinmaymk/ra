import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import type { Middleware, MiddlewareConfig, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext } from './types'
import { serializeContent } from '../providers/utils'

/**
 * Generic shell hook system for any middleware event.
 *
 * Runs external shell commands at any point in the agent loop lifecycle.
 * Commands receive context via environment variables and control flow
 * via exit codes:
 *
 *   Exit 0 — success (stdout is logged as feedback)
 *   Exit 2 — deny/stop (for beforeToolExecution: denies the tool call;
 *            for other hooks: stops the loop)
 *   Other  — warn (logged, execution continues)
 *
 * Environment variables set for all hooks:
 *   HOOK_EVENT     — the hook name (e.g. 'beforeToolExecution')
 *   HOOK_SESSION   — session ID
 *   HOOK_ITERATION — current loop iteration
 *
 * Additional variables per hook type:
 *   beforeToolExecution / afterToolExecution:
 *     HOOK_TOOL_NAME, HOOK_TOOL_INPUT, HOOK_TOOL_OUTPUT, HOOK_TOOL_IS_ERROR
 *   onError:
 *     HOOK_ERROR, HOOK_ERROR_PHASE
 */

type HookName = keyof MiddlewareConfig

export interface ShellHookEntry {
  /** Shell command to execute. */
  command: string
  /** Timeout in ms. Default: 10000. */
  timeout?: number
}

/** Map of hook event names to shell commands. */
export type ShellHooksConfig = Partial<Record<HookName, (string | ShellHookEntry)[]>>

export interface HookRunResult {
  denied: boolean
  messages: string[]
}

const DEFAULT_TIMEOUT = 10_000

function runShellCommand(command: string, env: Record<string, string>, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const isWindows = platform() === 'win32'
    const shell = isWindows ? 'cmd' : 'sh'
    const shellArgs = isWindows ? ['/C', command] : ['-c', command]

    const child = execFile(shell, shellArgs, {
      env: { ...(globalThis as { process?: { env?: Record<string, string> } }).process?.env, ...env },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    }, (error: Error | null, stdout: string, stderr: string) => {
      const exitCode = error && 'code' in error && typeof (error as { code: unknown }).code === 'number'
        ? (error as { code: number }).code
        : (child.exitCode ?? 1)
      resolve({ exitCode, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

async function runHooks(entries: (string | ShellHookEntry)[], env: Record<string, string>): Promise<HookRunResult> {
  const messages: string[] = []
  let denied = false

  for (const entry of entries) {
    const command = typeof entry === 'string' ? entry : entry.command
    const timeout = (typeof entry === 'object' ? entry.timeout : undefined) ?? DEFAULT_TIMEOUT
    const { exitCode, stdout, stderr } = await runShellCommand(command, env, timeout)

    if (exitCode === 0) {
      if (stdout) messages.push(stdout)
    } else if (exitCode === 2) {
      denied = true
      messages.push(stdout || 'Hook denied execution')
      break
    } else {
      const warning = stderr || stdout || `Hook exited with code ${exitCode}`
      messages.push(`[hook warning] ${warning}`)
    }
  }

  return { denied, messages }
}

/** Build base env vars common to all hooks. */
function baseEnv(hookName: string, loop: LoopContext): Record<string, string> {
  return {
    HOOK_EVENT: hookName,
    HOOK_SESSION: loop.sessionId,
    HOOK_ITERATION: String(loop.iteration),
  }
}

/**
 * Build a complete MiddlewareConfig from a shell hooks config.
 * Each hook event maps to shell commands that run at that lifecycle point.
 *
 * Example config:
 * ```
 * {
 *   beforeToolExecution: ['./hooks/check-tool.sh'],
 *   afterLoopComplete: ['./hooks/notify.sh'],
 *   onError: [{ command: './hooks/alert.sh', timeout: 5000 }],
 * }
 * ```
 */
export function createShellHooksMiddleware(config: ShellHooksConfig): Partial<MiddlewareConfig> {
  const result: Partial<MiddlewareConfig> = {}

  if (config.beforeLoopBegin?.length) {
    result.beforeLoopBegin = [createLoopHook('beforeLoopBegin', config.beforeLoopBegin)]
  }
  if (config.beforeModelCall?.length) {
    result.beforeModelCall = [createModelCallHook('beforeModelCall', config.beforeModelCall)]
  }
  if (config.onStreamChunk?.length) {
    result.onStreamChunk = [createStreamChunkHook(config.onStreamChunk)]
  }
  if (config.beforeToolExecution?.length) {
    result.beforeToolExecution = [createToolExecHook(config.beforeToolExecution)]
  }
  if (config.afterToolExecution?.length) {
    result.afterToolExecution = [createToolResultHook(config.afterToolExecution)]
  }
  if (config.afterModelResponse?.length) {
    result.afterModelResponse = [createModelCallHook('afterModelResponse', config.afterModelResponse)]
  }
  if (config.afterLoopIteration?.length) {
    result.afterLoopIteration = [createLoopHook('afterLoopIteration', config.afterLoopIteration)]
  }
  if (config.afterLoopComplete?.length) {
    result.afterLoopComplete = [createLoopHook('afterLoopComplete', config.afterLoopComplete)]
  }
  if (config.onError?.length) {
    result.onError = [createErrorHook(config.onError)]
  }

  return result
}

function createLoopHook(name: string, entries: (string | ShellHookEntry)[]): Middleware<LoopContext> {
  return async (ctx) => {
    const { denied, messages } = await runHooks(entries, baseEnv(name, ctx))
    if (messages.length) ctx.logger.debug('shell hook feedback', { hook: name, messages })
    if (denied) { ctx.stop(messages.join('\n') || `Shell hook stopped loop at ${name}`); ctx.logger.info('shell hook stopped loop', { hook: name }) }
  }
}

function createModelCallHook(name: string, entries: (string | ShellHookEntry)[]): Middleware<ModelCallContext> {
  return async (ctx) => {
    const env = { ...baseEnv(name, ctx.loop), HOOK_MODEL: ctx.request.model, HOOK_MESSAGE_COUNT: String(ctx.request.messages.length) }
    const { denied, messages } = await runHooks(entries, env)
    if (messages.length) ctx.logger.debug('shell hook feedback', { hook: name, messages })
    if (denied) { ctx.stop(messages.join('\n') || `Shell hook stopped loop at ${name}`); ctx.logger.info('shell hook stopped loop', { hook: name }) }
  }
}

function createStreamChunkHook(entries: (string | ShellHookEntry)[]): Middleware<StreamChunkContext> {
  return async (ctx) => {
    const env = { ...baseEnv('onStreamChunk', ctx.loop), HOOK_CHUNK_TYPE: ctx.chunk.type }
    const { messages } = await runHooks(entries, env)
    if (messages.length) ctx.logger.debug('shell hook feedback', { hook: 'onStreamChunk', messages })
  }
}

function createToolExecHook(entries: (string | ShellHookEntry)[]): Middleware<ToolExecutionContext> {
  return async (ctx) => {
    const env = { ...baseEnv('beforeToolExecution', ctx.loop), HOOK_TOOL_NAME: ctx.toolCall.name, HOOK_TOOL_INPUT: ctx.toolCall.arguments }
    const { denied, messages } = await runHooks(entries, env)
    if (messages.length) ctx.logger.debug('shell hook feedback', { hook: 'beforeToolExecution', messages })
    if (denied) {
      ctx.deny(messages.join('\n') || `Shell hook denied tool '${ctx.toolCall.name}'`)
      ctx.logger.info('shell hook denied tool', { tool: ctx.toolCall.name })
    }
  }
}

function createToolResultHook(entries: (string | ShellHookEntry)[]): Middleware<ToolResultContext> {
  return async (ctx) => {
    const output = typeof ctx.result.content === 'string' ? ctx.result.content : serializeContent(ctx.result.content)
    const env = {
      ...baseEnv('afterToolExecution', ctx.loop),
      HOOK_TOOL_NAME: ctx.toolCall.name,
      HOOK_TOOL_INPUT: ctx.toolCall.arguments,
      HOOK_TOOL_OUTPUT: output,
      HOOK_TOOL_IS_ERROR: String(ctx.result.isError ?? false),
    }
    const { denied, messages } = await runHooks(entries, env)
    if (messages.length) {
      const current = typeof ctx.result.content === 'string' ? ctx.result.content : serializeContent(ctx.result.content)
      const sections: string[] = []
      if (current.trim()) sections.push(current)
      sections.push(`${denied ? 'Hook feedback (denied)' : 'Hook feedback'}:\n${messages.join('\n')}`)
      ctx.result.content = sections.join('\n\n')
    }
    if (denied) { ctx.result.isError = true; ctx.logger.info('shell hook denied tool result', { tool: ctx.toolCall.name }) }
  }
}

function createErrorHook(entries: (string | ShellHookEntry)[]): Middleware<ErrorContext> {
  return async (ctx) => {
    const env = { ...baseEnv('onError', ctx.loop), HOOK_ERROR: ctx.error.message, HOOK_ERROR_PHASE: ctx.phase }
    const { messages } = await runHooks(entries, env)
    if (messages.length) ctx.logger.debug('shell hook feedback', { hook: 'onError', messages })
  }
}
