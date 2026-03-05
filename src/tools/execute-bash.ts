import type { ITool } from '../providers/types'
import { execFile } from 'child_process'

export function executeBashTool(): ITool {
  return {
    name: 'execute_bash',
    description:
      'Execute a bash command and return its output (stdout and stderr combined). ' +
      'The command runs in a bash shell on this system. Use standard bash syntax. ' +
      'Use the optional `timeout` parameter (in milliseconds) to limit execution time. Default timeout is 30 seconds. ' +
      'For long-running commands, consider running them in the background with "&" and redirecting output to a file. ' +
      'The `cwd` parameter sets the working directory for the command.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command. Optional.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Default: 30000. Optional.' },
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
