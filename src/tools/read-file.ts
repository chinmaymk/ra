import type { ITool } from '../providers/types'
import { readFile } from 'fs/promises'

export function readFileTool(): ITool {
  return {
    name: 'read_file',
    description:
      'Read the contents of a file at the given path. Returns the file content with line numbers prefixed (e.g. "1: first line"). ' +
      'Use the optional `offset` (1-based line number) and `limit` (number of lines) parameters to read a specific range of lines from large files. ' +
      'If no offset/limit is provided, the entire file is returned.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file to read' },
        offset: { type: 'number', description: 'Start reading from this line number (1-based). Optional.' },
        limit: { type: 'number', description: 'Maximum number of lines to return. Optional.' },
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
