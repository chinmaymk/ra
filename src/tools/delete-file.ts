import type { ITool } from '../providers/types'
import { rm, stat } from 'fs/promises'

export function deleteFileTool(): ITool {
  return {
    name: 'delete_file',
    description:
      'Delete a file or directory at the given path. ' +
      'Directories are deleted recursively, including all contents. ' +
      'This operation is irreversible — use with caution.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file or directory to delete' },
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
