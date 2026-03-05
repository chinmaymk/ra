import type { ITool } from '../providers/types'
import { cp, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function copyFileTool(): ITool {
  return {
    name: 'copy_file',
    description:
      'Copy a file or directory from source to destination. ' +
      'Directories are copied recursively, including all nested files and subdirectories. ' +
      'Creates parent directories at the destination if they do not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Path of the file or directory to copy' },
        destination: { type: 'string', description: 'Destination path for the copy' },
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
