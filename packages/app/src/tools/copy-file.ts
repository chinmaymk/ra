import type { ITool } from '@chinmaymk/ra'
import { cp } from 'fs/promises'
import { ensureDir } from './ensure-dir'
import { assertWithinRoot } from './root-dir'

export interface CopyFileToolOptions {
  rootDir?: string
}

export function copyFileTool(options?: CopyFileToolOptions): ITool {
  const rootDir = options?.rootDir
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
      if (rootDir) {
        assertWithinRoot(source, rootDir)
        assertWithinRoot(destination, rootDir)
      }
      await ensureDir(destination)
      await cp(source, destination, { recursive: true })
      return `Copied: ${source} → ${destination}`
    },
  }
}
