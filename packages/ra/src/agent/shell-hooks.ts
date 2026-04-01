import { execFile } from 'node:child_process'
import { platform } from 'node:os'
import type { Middleware, ToolExecutionContext, ToolResultContext } from './types'

/**
 * Shell-based pre/post tool execution hooks.
 *
 * Inspired by claw-code's hook runner pattern. Hooks are shell commands that run
 * before and/or after tool execution with well-defined exit code semantics:
 *
 *   Exit 0 — allow (stdout is appended as feedback)
 *   Exit 2 — deny the tool call (stdout becomes the denial reason)
 *   Other  — warn (logged but execution continues)
 *
 * Hook commands receive context via environment variables:
 *   HOOK_EVENT        — 'pre_tool_use' or 'post_tool_use'
 *   HOOK_TOOL_NAME    — name of the tool being executed
 *   HOOK_TOOL_INPUT   — JSON string of tool input
 *   HOOK_TOOL_OUTPUT  — tool output (post hooks only)
 *   HOOK_TOOL_IS_ERROR — 'true' or 'false' (post hooks only)
 */

export interface ShellHooksConfig {
  /** Shell commands to run before tool execution. */
  preToolUse?: string[]
  /** Shell commands to run after tool execution. */
  postToolUse?: string[]
  /** Timeout in ms for each hook command. Default: 10000. */
  timeout?: number
}

export interface HookRunResult {
  denied: boolean
  messages: string[]
}

function runShellCommand(command: string, env: Record<string, string>, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const isWindows = platform() === 'win32'
    const shell = isWindows ? 'cmd' : 'sh'
    const shellArgs = isWindows ? ['/C', command] : ['-c', command]

    const child = execFile(shell, shellArgs, {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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

async function runHooks(commands: string[], env: Record<string, string>, timeoutMs: number): Promise<HookRunResult> {
  const messages: string[] = []
  let denied = false

  for (const command of commands) {
    const { exitCode, stdout, stderr } = await runShellCommand(command, env, timeoutMs)

    if (exitCode === 0) {
      if (stdout) messages.push(stdout)
    } else if (exitCode === 2) {
      denied = true
      messages.push(stdout || `Hook denied tool execution`)
      break // Stop running further hooks once denied
    } else {
      // Non-zero, non-deny: warn
      const warning = stderr || stdout || `Hook exited with code ${exitCode}`
      messages.push(`[hook warning] ${warning}`)
    }
  }

  return { denied, messages }
}

/** Merge hook feedback messages into tool output. */
function mergeHookFeedback(hookMessages: string[], output: string, denied: boolean): string {
  if (hookMessages.length === 0) return output
  const sections: string[] = []
  if (output.trim()) sections.push(output)
  const label = denied ? 'Hook feedback (denied)' : 'Hook feedback'
  sections.push(`${label}:\n${hookMessages.join('\n')}`)
  return sections.join('\n\n')
}

/**
 * Create beforeToolExecution middleware that runs pre-tool-use shell hooks.
 * If any hook exits with code 2, the tool call is denied.
 */
export function createPreToolHookMiddleware(config: ShellHooksConfig): Middleware<ToolExecutionContext> {
  const commands = config.preToolUse ?? []
  const timeout = config.timeout ?? 10_000

  return async (ctx: ToolExecutionContext) => {
    if (commands.length === 0) return

    const env: Record<string, string> = {
      HOOK_EVENT: 'pre_tool_use',
      HOOK_TOOL_NAME: ctx.toolCall.name,
      HOOK_TOOL_INPUT: ctx.toolCall.arguments,
    }

    const result = await runHooks(commands, env, timeout)

    if (result.denied) {
      const reason = result.messages.join('\n') || `Pre-tool hook denied tool '${ctx.toolCall.name}'`
      ctx.deny(reason)
      ctx.logger.info('pre-tool hook denied', { tool: ctx.toolCall.name, reason })
    } else if (result.messages.length > 0) {
      ctx.logger.debug('pre-tool hook feedback', { tool: ctx.toolCall.name, messages: result.messages })
    }
  }
}

/**
 * Create afterToolExecution middleware that runs post-tool-use shell hooks.
 * Post hooks can append feedback to the tool result. If a hook exits with code 2,
 * the tool result is marked as an error.
 */
export function createPostToolHookMiddleware(config: ShellHooksConfig): Middleware<ToolResultContext> {
  const commands = config.postToolUse ?? []
  const timeout = config.timeout ?? 10_000

  return async (ctx: ToolResultContext) => {
    if (commands.length === 0) return

    const output = typeof ctx.result.content === 'string'
      ? ctx.result.content
      : JSON.stringify(ctx.result.content)

    const env: Record<string, string> = {
      HOOK_EVENT: 'post_tool_use',
      HOOK_TOOL_NAME: ctx.toolCall.name,
      HOOK_TOOL_INPUT: ctx.toolCall.arguments,
      HOOK_TOOL_OUTPUT: output,
      HOOK_TOOL_IS_ERROR: String(ctx.result.isError ?? false),
    }

    const result = await runHooks(commands, env, timeout)

    if (result.messages.length > 0) {
      const currentContent = typeof ctx.result.content === 'string'
        ? ctx.result.content : JSON.stringify(ctx.result.content)
      ctx.result.content = mergeHookFeedback(result.messages, currentContent, result.denied)
    }
    if (result.denied) {
      ctx.result.isError = true
      ctx.logger.info('post-tool hook denied', { tool: ctx.toolCall.name })
    }
  }
}

/**
 * Create both pre and post tool hook middleware from a single config.
 * Returns an object with `beforeToolExecution` and `afterToolExecution` arrays
 * ready to spread into a MiddlewareConfig.
 */
export function createShellHooksMiddleware(config: ShellHooksConfig): {
  beforeToolExecution: Middleware<ToolExecutionContext>[]
  afterToolExecution: Middleware<ToolResultContext>[]
} {
  return {
    beforeToolExecution: config.preToolUse?.length ? [createPreToolHookMiddleware(config)] : [],
    afterToolExecution: config.postToolUse?.length ? [createPostToolHookMiddleware(config)] : [],
  }
}
