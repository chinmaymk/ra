import type { ITool } from '../providers/types'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

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
      const entries = await readdir(path)
      const results: string[] = []
      for (const entry of entries) {
        const s = await stat(join(path, entry))
        results.push(s.isDirectory() ? `${entry}/` : entry)
      }
      return results.join('\n')
    },
  }
}
