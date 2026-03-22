import { resolve, relative, dirname, isAbsolute } from 'path'
import { realpathSync } from 'fs'
import type { ContextFile } from './types'
import type { ModelCallContext, Middleware } from '@chinmaymk/ra'
import { buildContextMessages } from './inject'

export interface DiscoverOptions {
  cwd: string
  patterns: string[]
}

export async function findGitRoot(cwd: string): Promise<string | null> {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
}

export async function discoverContextFiles(options: DiscoverOptions): Promise<ContextFile[]> {
  const { patterns } = options
  if (patterns.length === 0) return []

  const cwd = realpathSync(options.cwd)
  const root = (await findGitRoot(cwd)) ?? cwd

  // Walk from cwd up to git root, collecting each directory
  const dirs: string[] = []
  let current = cwd
  while (current !== root) {
    dirs.push(current)
    const parent = resolve(current, '..')
    if (parent === current) break
    current = parent
  }
  dirs.push(root)

  return scanDirs(dirs, patterns, root)
}

async function scanDirs(dirs: string[], patterns: string[], root: string, exclude?: Set<string>): Promise<ContextFile[]> {
  const files: ContextFile[] = []
  for (const dir of dirs) {
    for (const pattern of patterns) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({ cwd: dir, absolute: false, onlyFiles: true, dot: true })) {
          const absPath = resolve(dir, match)
          if (exclude?.has(absPath) || files.some(f => f.path === absPath)) continue
          try {
            files.push({ path: absPath, relativePath: relative(root, absPath), content: await Bun.file(absPath).text() })
          } catch { /* skip unreadable */ }
        }
      } catch { /* skip unscannable dir */ }
    }
  }
  return files
}

// ── Dynamic discovery middleware ─────────────────────────────────────

/** Collect directories to scan for context files from a file path.
 *  When `walk` is true, walks from the file's directory up to `root`,
 *  returning every intermediate directory (excluding `root` itself,
 *  since root-level files are already discovered at startup).
 *  When `walk` is false, returns only the file's immediate directory. */
function collectDirs(filePath: string, root: string, walk: boolean, checked: Set<string>): string[] {
  const dirs: string[] = []
  const start = dirname(filePath)
  if (!walk) {
    if (!checked.has(start)) { checked.add(start); dirs.push(start) }
    return dirs
  }
  let current = start
  const normalizedRoot = resolve(root)
  while (true) {
    if (!checked.has(current)) { checked.add(current); dirs.push(current) }
    if (resolve(current) === normalizedRoot) break
    const parent = resolve(current, '..')
    if (parent === current) break // filesystem root
    current = parent
  }
  return dirs
}

/** Extract absolute file paths from all messages (tool call arguments, tool results, and user text). */
function extractFilePathsFromMessages(messages: readonly { role: string; content?: string | unknown; toolCalls?: readonly { arguments?: string }[] }[]): string[] {
  const paths: string[] = []
  const absPathRe = /(?:^|[\s"'=:])(\/([\w.@-]+\/)*[\w.@-]+)/g
  for (const msg of messages) {
    // Tool call arguments
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        try {
          for (const v of Object.values(JSON.parse(tc.arguments || '{}')))
            if (typeof v === 'string' && isAbsolute(v) && !v.includes('\0')) paths.push(v)
        } catch { /* skip */ }
      }
    }
    // User/tool text content may reference paths
    if (typeof msg.content === 'string') {
      for (const m of msg.content.matchAll(absPathRe)) {
        if (m[1] && !m[1].includes('\0')) paths.push(m[1])
      }
    }
  }
  return paths
}

/** beforeModelCall middleware — discovers context files from directories referenced in conversation. */
export function createDiscoveryMiddleware(
  patterns: string[], root: string, initialPaths: Set<string>,
  options?: { subdirectoryWalk?: boolean },
): Middleware<ModelCallContext> {
  const seen = new Set(initialPaths)
  const checked = new Set<string>()
  const walk = options?.subdirectoryWalk ?? true

  return async (ctx: ModelCallContext) => {
    try {
      const filePaths = extractFilePathsFromMessages(ctx.request.messages)
      const dirs: string[] = []
      for (const fp of filePaths) {
        dirs.push(...collectDirs(fp, root, walk, checked))
      }
      if (dirs.length === 0) return

      const files = await scanDirs(dirs, patterns, root, seen)
      if (files.length === 0) return
      for (const f of files) seen.add(f.path)

      const msgs = buildContextMessages(files)
      const messages = ctx.request.messages
      let idx = 0
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (msg && typeof msg.content === 'string' && (msg.content as string).includes('<context-file '))
          idx = i + 1
      }
      messages.splice(idx, 0, ...msgs)
    } catch {
      // Context discovery is best-effort — never crash the agent loop
    }
  }
}
