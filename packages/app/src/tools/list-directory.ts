import type { ITool } from '@chinmaymk/ra'
import { readdir } from 'fs/promises'
import { join } from 'path'
import { assertWithinRoot } from './root-dir'

async function listRecursive(dir: string, currentDepth: number, maxDepth: number, prefix: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const lines: string[] = []
  for (const e of entries) {
    if (e.isDirectory()) {
      lines.push(`${prefix}${e.name}/`)
      if (currentDepth < maxDepth) {
        const children = await listRecursive(join(dir, e.name), currentDepth + 1, maxDepth, `${prefix}${e.name}/`)
        lines.push(...children)
      }
    } else {
      lines.push(`${prefix}${e.name}`)
    }
  }
  return lines
}

export interface LSToolOptions {
  rootDir?: string
}

export function listDirectoryTool(options?: LSToolOptions): ITool {
  const rootDir = options?.rootDir
  return {
    name: 'LS',
    description:
      'List contents of a directory, one entry per line. ' +
      'Directories are suffixed with "/" (e.g. "src/"). ' +
      'Set recursive=true to list nested contents up to a given depth (default 5).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list' },
        recursive: { type: 'boolean', description: 'Recurse into subdirectories (default false)' },
        depth: { type: 'number', description: 'Max recursion depth, 1-5 (default 3, only used when recursive=true)' },
      },
      required: ['path'],
    },
    async execute(input: unknown) {
      const { path, recursive, depth } = input as { path: string; recursive?: boolean; depth?: number }
      if (rootDir) assertWithinRoot(path, rootDir)
      const maxDepth = recursive ? Math.min(Math.max(depth ?? 3, 1), 5) : 1
      const lines = await listRecursive(path, 1, maxDepth, '')
      return lines.join('\n')
    },
  }
}
