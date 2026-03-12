import { resolve, relative, dirname, isAbsolute } from 'path'
import { realpathSync } from 'fs'
import { spawnSync } from 'node:child_process'
import fg from 'fast-glob'
import { readText } from '../utils/fs'
import type { ContextFile } from './types'
import type { ToolResultContext, Middleware } from '../agent/types'
import { buildContextMessages } from './inject'

export interface DiscoverOptions {
  cwd: string
  patterns: string[]
}

export async function findGitRoot(cwd: string): Promise<string | null> {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status !== 0) return null
  return result.stdout.toString().trim()
}

export async function discoverContextFiles(options: DiscoverOptions): Promise<ContextFile[]> {
  const { patterns } = options
  if (patterns.length === 0) return []

  const cwd = realpathSync(options.cwd)
  const root = (await findGitRoot(cwd)) ?? cwd

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

  return scanDirs(dirs, patterns, root)
}

async function scanDirs(dirs: string[], patterns: string[], root: string, exclude?: Set<string>): Promise<ContextFile[]> {
  const files: ContextFile[] = []
  for (const dir of dirs) {
    for (const pattern of patterns) {
      const matches = await fg(pattern, { cwd: dir, absolute: false, onlyFiles: true, dot: true })
      for (const match of matches) {
        const absPath = resolve(dir, match)
        if (exclude?.has(absPath) || files.some(f => f.path === absPath)) continue
        try {
          files.push({ path: absPath, relativePath: relative(root, absPath), content: await readText(absPath) })
        } catch { /* skip unreadable */ }
      }
    }
  }
  return files
}

// ── Dynamic discovery middleware ─────────────────────────────────────

/** afterToolExecution middleware — discovers context files from directories the agent touches. */
export function createDiscoveryMiddleware(
  patterns: string[], root: string, initialPaths: Set<string>,
): Middleware<ToolResultContext> {
  const seen = new Set(initialPaths)
  const checked = new Set<string>()

  return async (ctx: ToolResultContext) => {
    const dirs: string[] = []
    try {
      for (const v of Object.values(JSON.parse(ctx.toolCall.arguments || '{}')))
        if (typeof v === 'string' && isAbsolute(v)) {
          const d = dirname(v)
          if (!checked.has(d)) { checked.add(d); dirs.push(d) }
        }
    } catch { /* skip */ }
    if (dirs.length === 0) return

    const files = await scanDirs(dirs, patterns, root, seen)
    if (files.length === 0) return
    for (const f of files) seen.add(f.path)

    const msgs = buildContextMessages(files)
    const messages = ctx.loop.messages
    let idx = 0
    for (let i = 0; i < messages.length; i++)
      if (typeof messages[i]!.content === 'string' && (messages[i]!.content as string).includes('<context-file '))
        idx = i + 1
    messages.splice(idx, 0, ...msgs)
  }
}
