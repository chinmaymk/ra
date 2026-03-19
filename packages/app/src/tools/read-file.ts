import type { ITool } from '@chinmaymk/ra'
import { readFile } from 'fs/promises'
import { assertWithinRoot } from './root-dir'

export interface ReadToolOptions {
  rootDir?: string
}

export function readFileTool(options?: ReadToolOptions): ITool {
  const rootDir = options?.rootDir
  return {
    name: 'Read',
    description:
      'Read a file and return its contents with line numbers (e.g. "1: first line\\n2: second line"). ' +
      'Returns the entire file by default. Use `offset` and `limit` to read a specific range.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        offset: { type: 'number', description: 'Line number to start from (1-based)' },
        limit: { type: 'number', description: 'Number of lines to return' },
      },
      required: ['path'],
    },
    async execute(input: unknown) {
      const { path, offset, limit } = input as { path: string; offset?: number; limit?: number }
      if (rootDir) assertWithinRoot(path, rootDir)
      const content = await readFile(path, 'utf-8')
      const allLines = content.split('\n')
      if (allLines.at(-1) === '') allLines.pop()
      const start = Math.max(0, (offset ?? 1) - 1)
      const lines = allLines.slice(start, limit ? start + limit : undefined)
      return lines.map((line, i) => `${start + i + 1}: ${line}`).join('\n')
    },
  }
}
