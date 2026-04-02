import { execFile, type ExecFileException } from 'child_process'
import type { Middleware, LoopContext, ModelCallContext, StreamChunkContext, ToolExecutionContext, ToolResultContext, ErrorContext } from '@chinmaymk/ra'
import { serializeContent } from '@chinmaymk/ra'

const TIMEOUT = 10_000

function runScript(scriptPath: string, env: Record<string, string>): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = execFile('sh', [scriptPath], {
      env: { ...process.env, ...env },
      timeout: TIMEOUT,
      maxBuffer: 1024 * 1024,
    }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      const exitCode = error ? (typeof error.code === 'number' ? error.code : (child.exitCode ?? 1)) : 0
      resolve({ exitCode, stdout: stdout.trim(), stderr: stderr.trim() })
    })
  })
}

function baseEnv(hook: string, loop: LoopContext): Record<string, string> {
  return {
    HOOK_EVENT: hook,
    HOOK_SESSION: loop.sessionId,
    HOOK_ITERATION: String(loop.iteration),
  }
}

function handleResult(result: { exitCode: number; stdout: string; stderr: string }, ctx: { logger: { debug: (msg: string, data: Record<string, unknown>) => void; info: (msg: string, data: Record<string, unknown>) => void } }, hook: string): { denied: boolean; feedback: string } {
  if (result.exitCode === 0) {
    if (result.stdout) ctx.logger.debug('shell hook feedback', { hook, stdout: result.stdout })
    return { denied: false, feedback: result.stdout }
  }
  if (result.exitCode === 2) {
    ctx.logger.info('shell hook denied', { hook, stdout: result.stdout })
    return { denied: true, feedback: result.stdout || 'Shell hook denied execution' }
  }
  const warning = result.stderr || result.stdout || `Shell hook exited with code ${result.exitCode}`
  ctx.logger.debug('shell hook warning', { hook, warning })
  return { denied: false, feedback: `[hook warning] ${warning}` }
}

/**
 * Wrap a shell script into a middleware function for any hook event.
 * The script receives context via environment variables and controls
 * flow via exit codes (0=allow, 2=deny/stop, other=warn).
 */
export function wrapShellMiddleware(scriptPath: string, hook: string): Middleware<LoopContext | ModelCallContext | StreamChunkContext | ToolExecutionContext | ToolResultContext | ErrorContext> {
  return async (ctx: LoopContext | ModelCallContext | StreamChunkContext | ToolExecutionContext | ToolResultContext | ErrorContext) => {
    const loop = 'loop' in ctx ? ctx.loop : ctx as LoopContext
    const env = baseEnv(hook, loop)

    // Add hook-specific env vars
    if ('toolCall' in ctx) {
      const tc = (ctx as ToolExecutionContext | ToolResultContext).toolCall
      env.HOOK_TOOL_NAME = tc.name
      env.HOOK_TOOL_INPUT = tc.arguments
    }
    if ('result' in ctx) {
      const r = (ctx as ToolResultContext).result
      env.HOOK_TOOL_OUTPUT = typeof r.content === 'string' ? r.content : serializeContent(r.content)
      env.HOOK_TOOL_IS_ERROR = String(r.isError ?? false)
    }
    if ('request' in ctx) {
      env.HOOK_MODEL = (ctx as ModelCallContext).request.model
      env.HOOK_MESSAGE_COUNT = String((ctx as ModelCallContext).request.messages.length)
    }
    if ('error' in ctx) {
      env.HOOK_ERROR = (ctx as ErrorContext).error.message
      env.HOOK_ERROR_PHASE = (ctx as ErrorContext).phase
    }
    if ('chunk' in ctx) {
      env.HOOK_CHUNK_TYPE = (ctx as StreamChunkContext).chunk.type
    }

    const result = await runScript(scriptPath, env)
    const { denied, feedback } = handleResult(result, ctx, hook)

    if (denied) {
      if ('deny' in ctx && typeof ctx.deny === 'function') {
        ctx.deny(feedback)
      } else {
        ctx.stop(feedback)
      }
    }

    // For afterToolExecution, append feedback to tool result
    if ('result' in ctx && feedback && result.exitCode === 0) {
      const r = (ctx as ToolResultContext).result
      const current = typeof r.content === 'string' ? r.content : serializeContent(r.content)
      r.content = current + (current.trim() ? '\n\n' : '') + `Hook feedback:\n${feedback}`
    }
  }
}
