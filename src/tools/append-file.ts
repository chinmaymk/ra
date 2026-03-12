import type { ITool } from '../providers/types'
import { appendFile } from 'fs/promises'
import { ensureDir } from './ensure-dir'

export function appendFileTool(): ITool {
  return {
    name: 'AppendFile',
    description:
      'Append content to the end of a file. Creates the file and parent directories if missing. ' +
      'No newline is added automatically — include "\\n" in content if needed.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to append to (created if missing)' },
        content: { type: 'string', description: 'Content to append (verbatim, no auto-newline)' },
      },
      required: ['path', 'content'],
    },
    async execute(input: unknown) {
      const { path, content } = input as { path: string; content: string }
      await ensureDir(path)
      await appendFile(path, content, 'utf-8')
      return `Content appended to: ${path}`
    },
  }
}
