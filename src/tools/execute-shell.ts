import { execFile } from 'child_process'

/** Shared shell command executor used by bash and powershell tools. */
export function runShellCommand(
  binary: string,
  args: string[],
  options: { cwd?: string; timeout?: number },
): Promise<string> {
  const { cwd, timeout = 30000 } = options
  return new Promise<string>((resolve, reject) => {
    execFile(binary, args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && error.killed) {
        reject(new Error(`Command timed out after ${timeout}ms`))
        return
      }
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      resolve(output || (error ? `Exit code: ${error.code}` : '(no output)'))
    })
  })
}
