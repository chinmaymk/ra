import type { ITool } from '../providers/types'
import { readdir } from 'fs/promises'

export function listDirectoryTool(): ITool {
  return {
    name: 'LS',
    description:
      'List immediate children of a directory, one per line. ' +
      'Directories are suffixed with "/" (e.g. "src/"). Does not recurse.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
      },
      required: ['path'],
    },
    async execute(input: unknown) {
      const { path } = input as { path: string }
      const entries = await readdir(path, { withFileTypes: true })
      return entries.map(e => e.isDirectory() ? `${e.name}/` : e.name).join('\n')
    },
  }
}
