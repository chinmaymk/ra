import type { ITool } from '../providers/types'
import { execFile } from 'child_process'

export function executePowershellTool(): ITool {
  return {
    name: 'execute_powershell',
    description:
      'Execute a PowerShell command and return its output. ' +
      'The command runs in PowerShell on this Windows system. Use PowerShell syntax. ' +
      'Examples: "Get-ChildItem" to list files, "Get-Content file.txt" to read a file, "Remove-Item file.txt" to delete. ' +
      'Use the optional `timeout` parameter (in milliseconds) to limit execution time. Default timeout is 30 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The PowerShell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command. Optional.' },
        timeout: { type: 'number', description: 'Timeout in milliseconds. Default: 30000. Optional.' },
      },
      required: ['command'],
    },
    async execute(input: unknown) {
      const { command, cwd, timeout = 30000 } = input as { command: string; cwd?: string; timeout?: number }
      return new Promise<string>((resolve, reject) => {
        execFile('powershell', ['-NoProfile', '-Command', command], { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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
