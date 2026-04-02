import { spawn } from 'node:child_process'
import { resolvePath } from '../utils/paths'
import type { Logger } from '@chinmaymk/ra'
import type { Middleware, StoppableContext, LoopContext, ModelCallContext, ToolExecutionContext } from '@chinmaymk/ra'

/** Parse a `shell:` entry into command + args. */
export function parseShellEntry(entry: string): { command: string; args: string[] } {
  const raw = entry.slice('shell:'.length).trim()
  const parts = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []
  const cleaned = parts.map(p => {
    if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
      return p.slice(1, -1)
    }
    return p
  })
  if (cleaned.length === 0) throw new Error(`Empty shell middleware entry: "${entry}"`)
  return { command: cleaned[0]!, args: cleaned.slice(1) }
}

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

/** Grace period (ms) between SIGTERM and SIGKILL when aborting a shell process. */
const SIGKILL_GRACE_MS = 3_000

/**
 * Run a shell command as middleware. The command receives the serialized
 * context on stdin as JSON and may write a JSON response to stdout.
 *
 * **stdout**: optional JSON `{ stop?, deny?, context? }` — mutations applied back.
 * **stderr**: logged at debug level.
 * **exit code**: non-zero throws an error.
 */
function runShellProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  signal: AbortSignal,
  logger: Logger,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const onAbort = () => {
      proc.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL')
      }, SIGKILL_GRACE_MS)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    proc.on('error', (err) => {
      signal.removeEventListener('abort', onAbort)
      if (killTimer) clearTimeout(killTimer)
      reject(new Error(`Shell middleware failed to spawn "${command}": ${err.message}`))
    })

    proc.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (killTimer) clearTimeout(killTimer)
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')
      if (stderr) logger.debug('shell middleware stderr', { command, stderr: stderr.trim() })
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })

    proc.stdin.write(input)
    proc.stdin.end()
  })
}

/** Create a middleware function from a shell: entry. */
export function createShellMiddleware<T extends StoppableContext>(
  entry: string,
  hook: string,
  cwd: string,
  logger: Logger,
): Middleware<T> {
  const { command, args } = parseShellEntry(entry)

  // Resolve the command path if it looks like a relative/home path
  const resolvedCommand = (command.startsWith('./') || command.startsWith('../') || command.startsWith('~/'))
    ? resolvePath(command, cwd)
    : command

  return async (ctx: T) => {
    const payload = JSON.stringify(serializeContext(hook, ctx))
    const { stdout, stderr, exitCode } = await runShellProcess(resolvedCommand, args, payload, cwd, ctx.signal, ctx.logger ?? logger)

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
  }
}
