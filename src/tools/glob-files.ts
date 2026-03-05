import type { ITool } from '../providers/types'
import { Glob } from 'bun'

export function globFilesTool(): ITool {
  return {
    name: 'glob_files',
    description:
      'Find files matching a glob pattern within a directory. ' +
      'Returns a list of matching file paths, one per line. ' +
      'Supports standard glob patterns: "*" matches any file, "**" matches directories recursively, "?" matches a single character. ' +
      'Example patterns: "**/*.ts" (all TypeScript files), "src/**/*.test.ts" (all test files in src).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory to search in' },
        pattern: { type: 'string', description: 'Glob pattern to match files against' },
      },
      required: ['path', 'pattern'],
    },
    async execute(input: unknown) {
      const { path, pattern } = input as { path: string; pattern: string }
      const glob = new Glob(pattern)
      const results: string[] = []
      for await (const file of glob.scan({ cwd: path, dot: false })) {
        results.push(file)
      }
      results.sort()
      return results.length ? results.join('\n') : `No files found matching "${pattern}"`
    },
  }
}
