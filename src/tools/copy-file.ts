import type { ITool } from '../providers/types'
import { cp, mkdir } from 'fs/promises'
import { dirname } from 'path'

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
      await mkdir(dirname(destination), { recursive: true })
      await cp(source, destination, { recursive: true })
      return `Copied: ${source} → ${destination}`
    },
  }
}
