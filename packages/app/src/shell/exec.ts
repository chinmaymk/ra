import { spawn } from 'node:child_process'
import { resolvePath } from '../utils/paths'
import type { Logger } from '@chinmaymk/ra'

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
  if (cleaned.length === 0) throw new Error(`Empty shell entry: "${entry}"`)
  return { command: cleaned[0]!, args: cleaned.slice(1) }
}

/** Resolve a command path if it looks like a relative/home path. */
export function resolveCommand(command: string, cwd: string): string {
  return (command.startsWith('./') || command.startsWith('../') || command.startsWith('~/'))
    ? resolvePath(command, cwd)
    : command
}

/** Grace period (ms) between SIGTERM and SIGKILL when aborting a shell process. */
const SIGKILL_GRACE_MS = 3_000

/** Send a signal to the entire process group (negative PID), falling back to the process itself. */
function killProcessGroup(proc: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (proc.pid) process.kill(-proc.pid, signal)
  } catch {
    // Fallback: kill just the process (e.g. if process group doesn't exist)
    try { proc.kill(signal) } catch { /* already dead */ }
  }
}

/**
 * Spawn a shell process, pipe `input` to stdin, and collect stdout/stderr/exitCode.
 * Respects the provided AbortSignal — kills the process tree on abort.
 */
export function runShellProcess(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  signal: AbortSignal,
  logger: Logger,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // detached: true creates a new process group so we can kill the entire tree
    const proc = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd, detached: true })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let killTimer: ReturnType<typeof setTimeout> | undefined

    const killTree = () => {
      killProcessGroup(proc, 'SIGTERM')
      killTimer = setTimeout(() => {
        killProcessGroup(proc, 'SIGKILL')
      }, SIGKILL_GRACE_MS)
    }

    // If signal is already aborted (e.g. timeout fired before spawn), kill immediately
    if (signal.aborted) {
      killTree()
    } else {
      signal.addEventListener('abort', killTree, { once: true })
    }

    proc.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

    proc.on('error', (err) => {
      signal.removeEventListener('abort', killTree)
      if (killTimer) clearTimeout(killTimer)
      reject(new Error(`Shell process failed to spawn "${command}": ${err.message}`))
    })

    proc.on('close', (code) => {
      signal.removeEventListener('abort', killTree)
      if (killTimer) clearTimeout(killTimer)
      const stdout = Buffer.concat(stdoutChunks).toString('utf-8')
      const stderr = Buffer.concat(stderrChunks).toString('utf-8')
      if (stderr) logger.debug('shell process stderr', { command, stderr: stderr.trim() })
      resolve({ stdout, stderr, exitCode: code ?? 1 })
    })

    proc.stdin.write(input)
    proc.stdin.end()
  })
}
