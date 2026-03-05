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
      'Search for a text pattern across files in a directory, recursively. ' +
      'Returns matching lines with file paths and line numbers in the format "path:line:content". ' +
      'Skips node_modules and .git directories. ' +
      'Use the optional `include` parameter to filter by filename pattern (e.g. "*.ts", "*.json"). ' +
      'The pattern is matched as a plain string (not regex).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search in' },
        pattern: { type: 'string', description: 'Text pattern to search for' },
        include: { type: 'string', description: 'Optional filename glob filter, e.g. "*.ts"' },
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
