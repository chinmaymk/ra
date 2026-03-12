import { resolve, relative } from 'path'
import { realpathSync } from 'fs'
import type { ContextFile } from './types'

export interface DiscoverOptions {
  cwd: string
  patterns: string[]
}

async function findGitRoot(cwd: string): Promise<string | null> {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}

export { findGitRoot }

/**
 * Scan specific directories for context files matching the given patterns.
 * Unlike discoverContextFiles, this does NOT walk up the directory tree —
 * it only checks the exact directories provided.
 * Skips any files whose absolute paths are in the `exclude` set.
 */
export async function discoverContextInDirs(
  dirs: string[],
  patterns: string[],
  gitRoot: string,
  exclude?: Set<string>,
): Promise<ContextFile[]> {
  if (dirs.length === 0 || patterns.length === 0) return []
  const files: ContextFile[] = []
  for (const dir of dirs) {
    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern)
      for await (const match of glob.scan({ cwd: dir, absolute: false, onlyFiles: true, dot: true })) {
        const absPath = resolve(dir, match)
        if (exclude?.has(absPath)) continue
        if (files.some(f => f.path === absPath)) continue
        try {
          const content = await Bun.file(absPath).text()
          files.push({
            path: absPath,
            relativePath: relative(gitRoot, absPath),
            content,
          })
        } catch {
          // Skip unreadable files
        }
      }
    }
  }
  return files
}

export async function discoverContextFiles(options: DiscoverOptions): Promise<ContextFile[]> {
  const { patterns } = options
  if (patterns.length === 0) return []

  // Resolve symlinks so paths match git's output
  const cwd = realpathSync(options.cwd)
  const gitRoot = await findGitRoot(cwd)
  const root = gitRoot ?? cwd

  const dirs: string[] = []
  let current = cwd
  while (true) {
    dirs.push(current)
    if (current === root) break
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  if (dirs[dirs.length - 1] !== root) dirs.push(root)

  const files: ContextFile[] = []

  for (const dir of dirs) {
    for (const pattern of patterns) {
      const glob = new Bun.Glob(pattern)
      for await (const match of glob.scan({ cwd: dir, absolute: false, onlyFiles: true, dot: true })) {
        const absPath = resolve(dir, match)
        if (files.some(f => f.path === absPath)) continue
        try {
          const content = await Bun.file(absPath).text()
          files.push({
            path: absPath,
            relativePath: relative(root, absPath),
            content,
          })
        } catch {
          // Skip files that can't be read (deleted, permission denied, binary, etc.)
        }
      }
    }
  }

  return files
}
