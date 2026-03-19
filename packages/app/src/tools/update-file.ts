import type { ITool } from '@chinmaymk/ra'
import { readFile, writeFile } from 'fs/promises'
import { assertWithinRoot } from './root-dir'

export interface EditToolOptions {
  rootDir?: string
}

export function updateFileTool(options?: EditToolOptions): ITool {
  const rootDir = options?.rootDir
  return {
    name: 'Edit',
    description:
      'Replace the first occurrence of `old_string` with `new_string` in a file. ' +
      'IMPORTANT: `old_string` must match exactly, including whitespace, indentation, and newlines. ' +
      'Only the first match is replaced. Supports multi-line strings. ' +
      'Fails if `old_string` is not found. Use Write to create new files.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to update' },
        old_string: { type: 'string', description: 'Exact string to find (must match precisely)' },
        new_string: { type: 'string', description: 'Replacement string' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(input: unknown) {
      const { path, old_string, new_string } = input as { path: string; old_string: string; new_string: string }
      if (rootDir) assertWithinRoot(path, rootDir)
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
