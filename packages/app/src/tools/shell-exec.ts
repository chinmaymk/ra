import { execFile, type ExecFileException } from 'child_process'
import type { ITool } from '@chinmaymk/ra'

function shellExec(
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
      return shellExec(shell, shellArgs(command), { cwd, timeout })
    },
  }
}

export function executeBashTool(): ITool {
  const platform = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows (WSL/Git Bash)' : 'Linux'
  return shellTool('Bash', 'bash', cmd => ['-c', cmd],
    `Run a bash command on this ${platform} system. Returns stdout and stderr combined. Default timeout: 30s.`)
}

export function executePowershellTool(): ITool {
  return shellTool('PowerShell', 'powershell', cmd => ['-NoProfile', '-Command', cmd],
    'Run a PowerShell command on this Windows system. Returns stdout and stderr combined. Uses -NoProfile for fast startup. Default timeout: 30s.')
}
