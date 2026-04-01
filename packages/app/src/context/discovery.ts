import { resolve, relative, dirname, isAbsolute } from 'path'
import { realpathSync } from 'fs'
import type { ContextFile } from './types'
import type { ModelCallContext, Middleware } from '@chinmaymk/ra'
import { buildContextMessages } from './inject'

export interface DiscoverOptions {
  cwd: string
  patterns: string[]
  maxFileChars?: number
  maxTotalChars?: number
}

export async function findGitRoot(cwd: string): Promise<string | null> {
  const result = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], { cwd })
  if (result.exitCode !== 0) return null
  return result.stdout.toString().trim()
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

  return scanDirs(walkUpTo(cwd, root), patterns, root, undefined, { maxFileChars: options.maxFileChars, maxTotalChars: options.maxTotalChars })
}

const DEFAULT_MAX_FILE_CHARS = 10_000
const DEFAULT_MAX_TOTAL_CHARS = 30_000

interface ScanOptions {
  maxFileChars?: number
  maxTotalChars?: number
}

async function scanDirs(dirs: string[], patterns: string[], root: string, exclude?: Set<string>, opts?: ScanOptions): Promise<ContextFile[]> {
  const maxFileChars = opts?.maxFileChars ?? DEFAULT_MAX_FILE_CHARS
  const maxTotalChars = opts?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS
  const files: ContextFile[] = []
  let totalChars = 0
  for (const dir of dirs) {
    for (const pattern of patterns) {
      try {
        const glob = new Bun.Glob(pattern)
        for await (const match of glob.scan({ cwd: dir, absolute: false, onlyFiles: true, dot: true })) {
          const absPath = resolve(dir, match)
          if (exclude?.has(absPath) || files.some(f => f.path === absPath)) continue
          if (totalChars >= maxTotalChars) break
          try {
            let content = await Bun.file(absPath).text()
            if (content.length > maxFileChars) {
              content = content.slice(0, maxFileChars) + `\n\n[Truncated: file exceeded ${maxFileChars} character limit]`
            }
            if (totalChars + content.length > maxTotalChars) {
              const remaining = maxTotalChars - totalChars
              if (remaining > 200) {
                content = content.slice(0, remaining) + `\n\n[Truncated: total context file budget (${maxTotalChars} chars) reached]`
              } else {
                break
              }
            }
            totalChars += content.length
            files.push({ path: absPath, relativePath: relative(root, absPath), content })
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
 *  Deduplicates against `checked` set. */
function collectDirs(filePath: string, root: string, walk: boolean, checked: Set<string>): string[] {
  const start = dirname(filePath)
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
  options?: { subdirectoryWalk?: boolean; maxFileChars?: number; maxTotalChars?: number },
): Middleware<ModelCallContext> {
  const seen = new Set(initialPaths)
  const checked = new Set<string>()
  const walk = options?.subdirectoryWalk ?? true
  const scanOpts: ScanOptions = { maxFileChars: options?.maxFileChars, maxTotalChars: options?.maxTotalChars }

  return async (ctx: ModelCallContext) => {
    try {
      const filePaths = extractFilePathsFromMessages(ctx.request.messages)
      const dirs: string[] = []
      for (const fp of filePaths) {
        dirs.push(...collectDirs(fp, root, walk, checked))
      }
      if (dirs.length === 0) return

      const files = await scanDirs(dirs, patterns, root, seen, scanOpts)
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
    } catch {
      // Context discovery is best-effort — never crash the agent loop
    }
  }
}
