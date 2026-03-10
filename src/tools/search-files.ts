import type { ITool } from '../providers/types'
import { readdir, readFile } from 'fs/promises'
import { join, relative } from 'path'

async function* walkFiles(dir: string, include?: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      yield* walkFiles(full, include)
    } else {
      if (include) {
        const pattern = include.replace(/\*/g, '.*').replace(/\?/g, '.')
        if (!new RegExp(`^${pattern}$`).test(entry.name)) continue
      }
      yield full
    }
  }
}

export function searchFilesTool(): ITool {
  return {
    name: 'search_files',
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
      const results: string[] = []
      for await (const file of walkFiles(path, include)) {
        try {
          const content = await readFile(file, 'utf-8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(pattern)) {
              results.push(`${relative(path, file)}:${i + 1}:${lines[i]}`)
            }
          }
        } catch { /* skip binary/unreadable files */ }
      }
      return results.length ? results.join('\n') : `No matches found for "${pattern}"`
    },
  }
}
