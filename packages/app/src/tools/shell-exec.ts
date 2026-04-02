import { execFile, type ExecFileException } from 'child_process'
import type { ITool } from '@chinmaymk/ra'

/**
 * Commands where a non-zero exit code doesn't necessarily mean failure.
 * Maps base command → function that interprets the exit code.
 * Returns a human-readable note or undefined if the exit code is a real error.
 */
const COMMAND_SEMANTICS: Record<string, (code: number) => string | undefined> = {
  grep:  (c) => c === 1 ? 'No matches found (not an error)' : undefined,
  rg:    (c) => c === 1 ? 'No matches found (not an error)' : undefined,
  diff:  (c) => c === 1 ? 'Files differ (not an error)' : undefined,
  test:  (c) => c === 1 ? 'Condition evaluated to false (not an error)' : undefined,
  '[':   (c) => c === 1 ? 'Condition evaluated to false (not an error)' : undefined,
  find:  (c) => c === 1 ? 'Some directories were inaccessible (partial results returned)' : undefined,
}

/** Extract the base command from a shell command string (handles pipes — uses last command). */
function extractBaseCommand(command: string): string | undefined {
  const last = command.split('|').pop()?.trim()
  return last?.split(/\s+/)[0]
}

/** Get an interpretive note for a non-zero exit code, if applicable. */
function interpretExitCode(command: string, exitCode: number): string | undefined {
  if (exitCode === 0) return undefined
  const base = extractBaseCommand(command)
  if (!base) return undefined
  return COMMAND_SEMANTICS[base]?.(exitCode)
}

function shellExec(
  shell: string,
  args: string[],
  options: { cwd?: string; timeout: number },
  command: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(shell, args, { cwd: options.cwd, timeout: options.timeout, maxBuffer: 10 * 1024 * 1024 }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      if (error && error.killed) {
        reject(new Error(`Command timed out after ${options.timeout}ms`))
        return
      }
      const exitCode = error ? (error.code as number ?? 1) : 0
      const parts: string[] = []
      if (stdout.trim()) parts.push(`<stdout>\n${stdout.trim()}\n</stdout>`)
      if (stderr.trim()) parts.push(`<stderr>\n${stderr.trim()}\n</stderr>`)
      parts.push(`<exit_code>${exitCode}</exit_code>`)
      const note = interpretExitCode(command, exitCode)
      if (note) parts.push(`<exit_code_note>${note}</exit_code_note>`)
      resolve(parts.join('\n'))
    })
  })
}

export function shellTool(name: string, shell: string, shellArgs: (cmd: string) => string[], description: string): ITool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: `${name} command to run` },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['command'],
    },
    async execute(input: unknown) {
      const { command, cwd, timeout = 30000 } = input as { command: string; cwd?: string; timeout?: number }
      return shellExec(shell, shellArgs(command), { cwd, timeout }, command)
    },
  }
}

export function executeBashTool(): ITool {
  const platform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows (WSL/Git Bash)' : 'Linux'
  return shellTool('Bash', 'bash', cmd => ['-c', cmd],
    `Run a bash command on this ${platform} system. Returns stdout, stderr, and exit code. Default timeout: 30s.`)
}

export function executePowershellTool(): ITool {
  return shellTool('PowerShell', 'powershell', cmd => ['-NoProfile', '-Command', cmd],
    'Run a PowerShell command on this Windows system. Returns stdout, stderr, and exit code. Uses -NoProfile for fast startup. Default timeout: 30s.')
}
