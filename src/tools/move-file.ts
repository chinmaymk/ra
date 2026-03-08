import type { ITool } from '../providers/types'
import { rename } from 'fs/promises'
import { ensureParentDir } from '../utils/files'

export function moveFileTool(): ITool {
  return {
    name: 'move_file',
    description:
      'Move or rename a file or directory. Creates parent directories at the destination automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'Current path' },
        destination: { type: 'string', description: 'New path' },
      },
      required: ['source', 'destination'],
    },
    async execute(input: unknown) {
      const { source, destination } = input as { source: string; destination: string }
      await ensureParentDir(destination)
      await rename(source, destination)
      return `Moved: ${source} → ${destination}`
    },
  }
}
