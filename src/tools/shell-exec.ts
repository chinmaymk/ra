import { execFile, type ExecFileException } from 'child_process'

/** Shared shell command execution used by Bash and PowerShell tools. */
export function shellExec(
  shell: string,
  args: string[],
  options: { cwd?: string; timeout: number },
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(shell, args, { cwd: options.cwd, timeout: options.timeout, maxBuffer: 10 * 1024 * 1024 }, (error: ExecFileException | null, stdout: string, stderr: string) => {
      if (error && error.killed) {
        reject(new Error(`Command timed out after ${options.timeout}ms`))
        return
      }
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      resolve(output || (error ? `Exit code: ${error.code}` : '(no output)'))
    })
  })
}
