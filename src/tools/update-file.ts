import type { ITool } from '../providers/types'
import { readFile, writeFile } from 'fs/promises'

export function updateFileTool(): ITool {
  return {
    name: 'update_file',
    description:
      'Update a file by replacing the first occurrence of `old_string` with `new_string`. ' +
      'The old_string must match exactly (including whitespace and indentation). ' +
      'Only the first occurrence is replaced. ' +
      'Use this for surgical edits to existing files. For creating new files, use write_file instead.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to update' },
        old_string: { type: 'string', description: 'The exact string to find in the file' },
        new_string: { type: 'string', description: 'The string to replace old_string with' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(input: unknown) {
      const { path, old_string, new_string } = input as { path: string; old_string: string; new_string: string }
      const content = await readFile(path, 'utf-8')
      if (!content.includes(old_string)) {
        throw new Error(`old_string not found in ${path}. Make sure the string matches exactly, including whitespace and indentation.`)
      }
      const updated = content.replace(old_string, new_string)
      await writeFile(path, updated, 'utf-8')
      return `File updated: ${path}`
    },
  }
}
