import type { ITool } from '@chinmaymk/ra'
import { Glob } from 'bun'
import { stat } from 'fs/promises'
import { join } from 'path'
import { assertWithinRoot } from './root-dir'

const MAX_RESULTS = 200

export interface GlobToolOptions {
  rootDir?: string
}

export function globFilesTool(options?: GlobToolOptions): ITool {
  const rootDir = options?.rootDir
  return {
    name: 'Glob',
    description:
      'Find files matching a glob pattern. Returns matching paths sorted by modification time (most recent first). ' +
      'Patterns: "*" = any file, "**" = recursive directories, "?" = single char. ' +
      `Results capped at ${MAX_RESULTS} files. ` +
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
      const { path: basePath, pattern } = input as { path: string; pattern: string }
      if (rootDir) assertWithinRoot(basePath, rootDir)
      const glob = new Glob(pattern)
      const files: { name: string; mtime: number }[] = []
      try {
        for await (const file of glob.scan({ cwd: basePath, dot: false })) {
          try {
            const s = await stat(join(basePath, file))
            files.push({ name: file, mtime: s.mtimeMs })
          } catch {
            files.push({ name: file, mtime: 0 })
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Failed to scan "${basePath}" with pattern "${pattern}": ${message}`)
      }
      files.sort((a, b) => b.mtime - a.mtime)
      const total = files.length
      const truncated = total > MAX_RESULTS
      const results = files.slice(0, MAX_RESULTS).map(f => f.name)
      if (!results.length) return `No files found matching "${pattern}"`
      const suffix = truncated ? `\n\n[Truncated: showing ${MAX_RESULTS} of ${total} files]` : ''
      return results.join('\n') + suffix
    },
  }
}
