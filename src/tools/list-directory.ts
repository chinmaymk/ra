import type { ITool } from '../providers/types'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export function listDirectoryTool(): ITool {
  return {
    name: 'list_directory',
    description:
      'List the files and directories at the given path. ' +
      'Returns one entry per line. Directories have a trailing "/" to distinguish them from files. ' +
      'Does not recurse into subdirectories — only lists the immediate children.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the directory to list' },
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
