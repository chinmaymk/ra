import type { ITool } from '../providers/types'
import { runShellCommand } from './execute-shell'

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
      const { command, cwd, timeout } = input as { command: string; cwd?: string; timeout?: number }
      return runShellCommand('bash', ['-c', command], { cwd, timeout })
    },
  }
}
