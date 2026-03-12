import type { ITool } from '../providers/types'
import { cp } from 'fs/promises'
import { ensureDir } from './ensure-dir'

export function copyFileTool(): ITool {
  return {
    name: 'CopyFile',
    description:
      'Copy a file or directory to a new location. Directories are copied recursively. ' +
      'Creates parent directories at the destination automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Path to copy from' },
        destination: { type: 'string', description: 'Path to copy to' },
      },
      required: ['source', 'destination'],
    },
    async execute(input: unknown) {
      const { source, destination } = input as { source: string; destination: string }
      await ensureDir(destination)
      await cp(source, destination, { recursive: true })
      return `Copied: ${source} → ${destination}`
    },
  }
}
