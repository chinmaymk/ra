import type { ITool } from '../providers/types'
import { writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'

export function writeFileTool(): ITool {
  return {
    name: 'write_file',
    description:
      'Create or overwrite a file at the given path with the provided content. ' +
      'Parent directories are created automatically if they do not exist. ' +
      'If the file already exists, it will be completely replaced with the new content. ' +
      'Use update_file instead if you only want to change part of an existing file.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute or relative path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['path', 'content'],
    },
    async execute(input: unknown) {
      const { path, content } = input as { path: string; content: string }
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf-8')
      return `File written: ${path}`
    },
  }
}
