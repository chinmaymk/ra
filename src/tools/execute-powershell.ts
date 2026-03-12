import type { ITool } from '../providers/types'
import { shellExec } from './shell-exec'

export function executePowershellTool(): ITool {
  return {
    name: 'PowerShell',
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
      const { command, cwd, timeout = 30000 } = input as { command: string; cwd?: string; timeout?: number }
      return shellExec('powershell', ['-NoProfile', '-Command', command], { cwd, timeout })
    },
  }
}
