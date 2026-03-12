import { execFile } from 'child_process'

const MAX_BUFFER = 10 * 1024 * 1024

/** Execute a shell command and return combined stdout+stderr */
export function shellExec(binary: string, args: string[], cwd: string | undefined, timeout: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(binary, args, { cwd, timeout, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      if (error && error.killed) {
        reject(new Error(`Command timed out after ${timeout}ms`))
        return
      }
      const output = [stdout, stderr].filter(Boolean).join('\n').trim()
      resolve(output || (error ? `Exit code: ${error.code}` : '(no output)'))
    })
  })
}
