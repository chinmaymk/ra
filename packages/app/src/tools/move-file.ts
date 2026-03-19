import type { ITool } from '@chinmaymk/ra'
import { rename } from 'fs/promises'
import { ensureDir } from './ensure-dir'
import { assertWithinRoot } from './root-dir'

export interface MoveFileToolOptions {
  rootDir?: string
}

export function moveFileTool(options?: MoveFileToolOptions): ITool {
  const rootDir = options?.rootDir
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
      if (rootDir) {
        assertWithinRoot(source, rootDir)
        assertWithinRoot(destination, rootDir)
      }
      await ensureDir(destination)
      await rename(source, destination)
      return `Moved: ${source} → ${destination}`
    },
  }
}
