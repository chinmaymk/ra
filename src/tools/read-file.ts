import type { ITool } from '../providers/types'
import { readFile } from 'fs/promises'

export function readFileTool(): ITool {
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
      const content = await readFile(path, 'utf-8')
      let lines = content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      const startLine = offset ? Math.max(1, offset) : 1
      const startIdx = startLine - 1
      const endIdx = limit ? startIdx + limit : lines.length
      lines = lines.slice(startIdx, endIdx)
      return lines.map((line, i) => `${startLine + i}: ${line}`).join('\n')
    },
  }
}
