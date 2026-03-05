import type { ITool } from '../providers/types'
import { rename, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function moveFileTool(): ITool {
  return {
    name: 'move_file',
    description:
      'Move or rename a file or directory from source to destination. ' +
      'Creates parent directories at the destination if they do not exist. ' +
      'Works on both files and directories.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Current path of the file or directory' },
        destination: { type: 'string', description: 'New path for the file or directory' },
      },
      required: ['source', 'destination'],
    },
    async execute(input: unknown) {
      const { source, destination } = input as { source: string; destination: string }
      await mkdir(dirname(destination), { recursive: true })
      await rename(source, destination)
      return `Moved: ${source} → ${destination}`
    },
  }
}
