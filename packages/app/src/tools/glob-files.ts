import type { ITool } from '@chinmaymk/ra'
import { Glob } from 'bun'
import { assertWithinRoot } from './root-dir'

export interface GlobToolOptions {
  rootDir?: string
}

export function globFilesTool(options?: GlobToolOptions): ITool {
  const rootDir = options?.rootDir
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
      if (rootDir) assertWithinRoot(path, rootDir)
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
