import { parseShellEntry, resolveCommand, runShellProcess } from '../shell'
import type { Logger } from '@chinmaymk/ra'
import type { Middleware, StoppableContext, LoopContext, ModelCallContext, ToolExecutionContext } from '@chinmaymk/ra'

// Re-export for backwards compatibility (tests and other consumers import from here)
export { parseShellEntry }

/** Serialize the context into a JSON-safe payload for stdin. */
function serializeContext(hook: string, ctx: StoppableContext): Record<string, unknown> {
  const payload: Record<string, unknown> = { hook }

  const loopCtx = 'loop' in ctx ? (ctx as { loop: LoopContext }).loop : undefined
  const directLoop = 'iteration' in ctx ? (ctx as unknown as LoopContext) : undefined
  const loop = loopCtx ?? directLoop

  if (loop) {
    payload.loop = {
      iteration: loop.iteration,
      maxIterations: loop.maxIterations,
      sessionId: loop.sessionId,
      usage: loop.usage,
      resumed: loop.resumed,
      messages: loop.messages,
    }
  }

  if ('request' in ctx) {
    const mc = ctx as ModelCallContext
    payload.request = {
      model: mc.request.model,
      messages: mc.request.messages,
      tools: mc.request.tools?.map(t => ({ name: t.name, description: t.description })),
      thinking: mc.request.thinking,
    }
  }

  if ('toolCall' in ctx) {
    const tc = ctx as unknown as { toolCall: { id: string; name: string; arguments: string } }
    payload.toolCall = { id: tc.toolCall.id, name: tc.toolCall.name, arguments: tc.toolCall.arguments }
  }

  if ('result' in ctx) {
    const tr = ctx as unknown as { result: { toolCallId: string; content: string; isError?: boolean } }
    payload.result = { toolCallId: tr.result.toolCallId, content: tr.result.content, isError: tr.result.isError }
  }

  if ('error' in ctx) {
    const ec = ctx as unknown as { error: Error; phase: string }
    payload.error = { message: ec.error.message, stack: ec.error.stack }
    payload.phase = ec.phase
  }

  // For direct loop contexts (beforeLoopBegin, afterLoopIteration, afterLoopComplete),
  // also include messages at top level for direct access
  if (directLoop) {
    payload.messages = directLoop.messages
  }

  return payload
}

/** Apply mutations from the script's stdout JSON back onto the context. */
function applyMutations(ctx: StoppableContext, output: Record<string, unknown>): void {
  if (output.stop) {
    const reason = typeof output.stop === 'string' ? output.stop : undefined
    ctx.stop(reason)
  }

  if (typeof output.deny === 'string' && 'deny' in ctx) {
    (ctx as ToolExecutionContext).deny(output.deny)
  }

  // Apply context mutations
  const mutations = output.context as Record<string, unknown> | undefined
  if (!mutations) return

  // beforeModelCall / afterModelResponse: mutate request
  if ('request' in ctx && mutations.request) {
    const mc = ctx as ModelCallContext
    const reqMut = mutations.request as Record<string, unknown>
    if (reqMut.messages) mc.request.messages = reqMut.messages as ModelCallContext['request']['messages']
    if (reqMut.tools) mc.request.tools = reqMut.tools as ModelCallContext['request']['tools']
  }

  // beforeLoopBegin: mutate messages directly
  if (mutations.messages && 'messages' in ctx) {
    (ctx as unknown as LoopContext).messages = mutations.messages as LoopContext['messages']
  }
}

/**
 * Create a middleware function from a shell: entry.
 *
 * `timeoutMs` is enforced directly by killing the child process. This ensures
 * the process is actually terminated when the middleware chain's `withTimeout`
 * wrapper fires, rather than leaving an orphaned process.
 */
export function createShellMiddleware<T extends StoppableContext>(
  entry: string,
  hook: string,
  cwd: string,
  logger: Logger,
  timeoutMs: number = 0,
): Middleware<T> {
  const { command, args } = parseShellEntry(entry)
  const resolvedCommand = resolveCommand(command, cwd)

  return async (ctx: T) => {
    // Combine the loop's abort signal with a per-execution timeout signal so the
    // child process is always killed — whether the loop stops or the timeout fires.
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined
    const ac = new AbortController()

    const onParentAbort = () => ac.abort()
    ctx.signal.addEventListener('abort', onParentAbort, { once: true })

    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(() => ac.abort(), timeoutMs)
    }

    try {
      const payload = JSON.stringify(serializeContext(hook, ctx))
      const { stdout, stderr, exitCode } = await runShellProcess(resolvedCommand, args, payload, cwd, ac.signal, ctx.logger ?? logger)

      if (exitCode !== 0) {
        const detail = stderr.trim() ? `\n  stderr: ${stderr.trim().slice(0, 500)}` : ''
        throw new Error(`Shell middleware "${entry}" exited with code ${exitCode}${detail}`)
      }

      const trimmed = stdout.trim()
      if (!trimmed) return

      let output: Record<string, unknown>
      try {
        output = JSON.parse(trimmed) as Record<string, unknown>
      } catch {
        throw new Error(`Shell middleware "${entry}" produced invalid JSON on stdout: ${trimmed.slice(0, 200)}`)
      }

      applyMutations(ctx, output)
    } finally {
      ctx.signal.removeEventListener('abort', onParentAbort)
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }
  }
}
