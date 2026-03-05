import type { ITool } from '../providers/types'
import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function appendFileTool(): ITool {
  return {
    name: 'append_file',
    description:
      'Append content to the end of a file. Creates the file (and parent directories) if it does not exist. ' +
      'Does not add any separator — if you need a newline before the appended content, include it in the content string.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to append to' },
        content: { type: 'string', description: 'Content to append to the end of the file' },
      },
      required: ['path', 'content'],
    },
    async execute(input: unknown) {
      const { path, content } = input as { path: string; content: string }
      await mkdir(dirname(path), { recursive: true })
      await appendFile(path, content, 'utf-8')
      return `Content appended to: ${path}`
    },
  }
}
