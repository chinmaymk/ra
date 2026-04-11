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

/** Resolve symlinks where possible; fall back to the input path if realpath
 *  fails (the path may not exist yet, e.g. a tool argument for a file the
 *  model is about to create). Keeps the middleware's path comparisons
 *  consistent with `discoverContextFiles`, which realpaths its cwd. */
function safeRealpath(p: string): string {
  try { return realpathSync(p) } catch { return p }
}

/** Walk from `start` up to `stop` (inclusive), returning each directory. */
function walkUpTo(start: string, stop: string): string[] {
  const normalizedStop = resolve(stop)
  const dirs: string[] = []
  let current = start
  while (true) {
    dirs.push(current)
    if (resolve(current) === normalizedStop) break
    const parent = resolve(current, '..')
    if (parent === current) break // filesystem root
    current = parent
  }
  return dirs
}

export async function discoverContextFiles(options: DiscoverOptions): Promise<ContextFile[]> {
  const { patterns } = options
  if (patterns.length === 0) return []

  const cwd = realpathSync(options.cwd)
  const root = (await findGitRoot(cwd)) ?? cwd

  return scanDirs(walkUpTo(cwd, root), patterns, root)
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
 *  When `walk` is true, walks from the file's directory up to `root`.
 *  When `walk` is false, returns only the file's immediate directory.
 *  Deduplicates against `checked` set.
 *
 *  The file itself may not exist yet (the tool call may be about to create
 *  it), so we realpath the *containing directory* — not the file — before
 *  walking. This keeps the walk path in the same canonical namespace as
 *  `root` (e.g. on macOS `/tmp` → `/private/tmp`) so `walkUpTo` actually
 *  reaches the stop and `scanDirs` produces absPaths that match the
 *  canonicalized `seen` set. Without this, walks started from an
 *  uncanonical `/tmp/...` path never stop at a canonical root and end
 *  up re-scanning every parent, rediscovering the initialPaths entries. */
function collectDirs(filePath: string, root: string, walk: boolean, checked: Set<string>): string[] {
  const start = safeRealpath(dirname(filePath))
  const candidates = walk ? walkUpTo(start, root) : [start]
  return candidates.filter(d => { if (checked.has(d)) return false; checked.add(d); return true })
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
  // Normalize everything through realpath so the middleware's view of the
  // filesystem matches discoverContextFiles (which realpaths its cwd). On
  // macOS `/tmp` is a symlink to `/private/tmp`, so without this, paths
  // extracted from tool calls walk up through `/tmp/...` and never match
  // the canonical root, causing seen/initialPaths dedup to miss and the
  // same CLAUDE.md to be re-injected on every iteration.
  const canonicalRoot = safeRealpath(root)
  const seen = new Set(Array.from(initialPaths, safeRealpath))
  const checked = new Set<string>()
  const walk = options?.subdirectoryWalk ?? true

  return async (ctx: ModelCallContext) => {
    try {
      const filePaths = extractFilePathsFromMessages(ctx.request.messages)
      const dirs: string[] = []
      for (const fp of filePaths) {
        dirs.push(...collectDirs(fp, canonicalRoot, walk, checked))
      }
      if (dirs.length === 0) return

      const files = await scanDirs(dirs, patterns, canonicalRoot, seen)
      if (files.length === 0) return
      for (const f of files) seen.add(f.path)
      ctx.logger.info('dynamic context files discovered', { fileCount: files.length, files: files.map(f => f.relativePath), dirsScanned: dirs.length })

      const msgs = buildContextMessages(files)
      const messages = ctx.request.messages
      let idx = 0
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i]
        if (msg && typeof msg.content === 'string' && (msg.content as string).includes('<context-file '))
          idx = i + 1
      }
      messages.splice(idx, 0, ...msgs)
    } catch (err) {
      // Context discovery is best-effort — never crash the agent loop
      ctx.logger.debug('dynamic context discovery failed', { error: err instanceof Error ? err.message : String(err) })
    }
  }
}
