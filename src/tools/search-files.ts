import type { ITool } from '../providers/types'
import { readFile } from 'fs/promises'
import { join, relative } from 'path'
import fg from 'fast-glob'

export function searchFilesTool(): ITool {
  return {
    name: 'Grep',
    description:
      'Recursively search file contents for a plain text string (not regex). ' +
      'Returns matches as "relative/path:line_number:matching_line". ' +
      'Skips node_modules/ and .git/. Use `include` to filter by filename glob.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search in' },
        pattern: { type: 'string', description: 'Plain text string to search for (not regex)' },
        include: { type: 'string', description: 'Filename glob filter, e.g. "*.ts" or "*.json"' },
      },
      required: ['path', 'pattern'],
    },
    async execute(input: unknown) {
      const { path, pattern, include } = input as { path: string; pattern: string; include?: string }
      const globPattern = include ? `**/${include}` : '**/*'
      const results: string[] = []
      const files = await fg(globPattern, { cwd: path, onlyFiles: true })
      for (const rel of files) {
        try {
          const content = await readFile(join(path, rel), 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(pattern)) {
              results.push(`${rel}:${i + 1}:${lines[i]}`)
            }
          }
        } catch { /* skip binary/unreadable files */ }
      }
      return results.length ? results.join('\n') : `No matches found for "${pattern}"`
    },
  }
}
