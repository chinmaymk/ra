import type { ITool } from '../providers/types'
import { rm, stat } from 'fs/promises'

export function deleteFileTool(): ITool {
  return {
    name: 'delete_file',
    description:
      'Delete a file or directory. Directories are deleted recursively. ' +
      'IRREVERSIBLE. Fails if path does not exist.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to delete' },
      },
      required: ['path'],
    },
    async execute(input: unknown) {
      const { path } = input as { path: string }
      await stat(path)
      await rm(path, { recursive: true })
      return `Deleted: ${path}`
    },
  }
}
