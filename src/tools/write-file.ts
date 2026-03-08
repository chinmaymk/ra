import type { ITool } from '../providers/types'
import { writeFile } from 'fs/promises'
import { ensureParentDir } from '../utils/files'

export function writeFileTool(): ITool {
  return {
    name: 'write_file',
    description:
      'Create or overwrite a file with the given content. Parent directories are created automatically. ' +
      'WARNING: Overwrites the entire file if it exists. Use update_file for partial edits.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to create or overwrite' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
    async execute(input: unknown) {
      const { path, content } = input as { path: string; content: string }
      await ensureParentDir(path)
      await writeFile(path, content, 'utf-8')
      return `File written: ${path}`
    },
  }
}
