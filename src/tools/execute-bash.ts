import type { ITool } from '../providers/types'
import { execFile } from 'child_process'

export function executeBashTool(): ITool {
  return {
    name: 'execute_bash',
    description:
      `Run a bash command on this ${process.platform === 'darwin' ? 'macOS' : 'Linux'} system. ` +
      'Returns stdout and stderr combined. Default timeout: 30s.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Bash command to run' },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['command'],
    },
    async execute(input: unknown) {
      const { command, cwd, timeout = 30000 } = input as { command: string; cwd?: string; timeout?: number }
      return new Promise<string>((resolve, reject) => {
        execFile('bash', ['-c', command], { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
          if (error && error.killed) {
            reject(new Error(`Command timed out after ${timeout}ms`))
            return
          }
          const output = [stdout, stderr].filter(Boolean).join('\n').trim()
          resolve(output || (error ? `Exit code: ${error.code}` : '(no output)'))
        })
      })
    },
  }
}
