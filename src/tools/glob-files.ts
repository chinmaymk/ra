import type { ITool } from '../providers/types'
import fg from 'fast-glob'

export function globFilesTool(): ITool {
  return {
    name: 'Glob',
    description:
      'Find files matching a glob pattern. Returns matching paths, one per line. ' +
      'Patterns: "*" = any file, "**" = recursive directories, "?" = single char. ' +
      'Examples: "**/*.ts", "src/**/*.test.ts", "*.json".',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Base directory to search from' },
        pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.ts")' },
      },
      required: ['path', 'pattern'],
    },
    async execute(input: unknown) {
      const { path, pattern } = input as { path: string; pattern: string }
      const results = await fg(pattern, { cwd: path, dot: false })
      results.sort()
      return results.length ? results.join('\n') : `No files found matching "${pattern}"`
    },
  }
}
