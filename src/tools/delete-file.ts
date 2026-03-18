import type { ITool } from '../providers/types'
import { rm } from 'fs/promises'
import { assertWithinRoot } from './root-dir'

export interface DeleteFileToolOptions {
  rootDir?: string
}

export function deleteFileTool(options?: DeleteFileToolOptions): ITool {
  const rootDir = options?.rootDir
  return {
    name: 'DeleteFile',
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
      if (rootDir) assertWithinRoot(path, rootDir)
      await rm(path, { recursive: true })
      return `Deleted: ${path}`
    },
  }
}
