import type { ITool } from '../providers/types'
import { runShellCommand } from './execute-shell'

export function executePowershellTool(): ITool {
  return {
    name: 'execute_powershell',
    description:
      'Run a PowerShell command on this Windows system. ' +
      'Returns stdout and stderr combined. Uses -NoProfile for fast startup. Default timeout: 30s.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell command to run' },
        cwd: { type: 'string', description: 'Working directory' },
        timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
      },
      required: ['command'],
    },
    async execute(input: unknown) {
      const { command, cwd, timeout } = input as { command: string; cwd?: string; timeout?: number }
      return runShellCommand('powershell', ['-NoProfile', '-Command', command], { cwd, timeout })
    },
  }
}
