import type { ITool } from '../providers/types'
import { rename, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function moveFileTool(): ITool {
  return {
    name: 'MoveFile',
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
      await mkdir(dirname(destination), { recursive: true })
      await rename(source, destination)
      return `Moved: ${source} → ${destination}`
    },
  }
}
