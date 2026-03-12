import { resolve, relative, dirname, isAbsolute } from 'path'
import { realpathSync } from 'fs'
import type { ContextFile } from './types'
import type { ModelCallContext, Middleware } from '../agent/types'
import type { IMessage } from '../providers/types'
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
      const glob = new Bun.Glob(pattern)
      for await (const match of glob.scan({ cwd: dir, absolute: false, onlyFiles: true, dot: true })) {
        const absPath = resolve(dir, match)
        if (exclude?.has(absPath) || files.some(f => f.path === absPath)) continue
        try {
          files.push({ path: absPath, relativePath: relative(root, absPath), content: await Bun.file(absPath).text() })
        } catch { /* skip unreadable */ }
      }
    }
  }
  return files
}

// ── Dynamic discovery middleware ─────────────────────────────────────

const ABS_PATH_RE = /(?:^|[\s"'=:])(\/.+?)(?=[\s"',)\]}>]|$)/g

function toDir(p: string): string {
  return !p.endsWith('/') && p.slice(p.lastIndexOf('/') + 1).includes('.') ? dirname(p) : p
}

function extractDirs(messages: IMessage[], from: number): Set<string> {
  const dirs = new Set<string>()
  for (let i = from; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        try {
          for (const v of Object.values(JSON.parse(tc.arguments || '{}')))
            if (typeof v === 'string' && isAbsolute(v)) dirs.add(toDir(v))
        } catch { /* skip */ }
      }
    }
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      ABS_PATH_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = ABS_PATH_RE.exec(msg.content)) !== null) dirs.add(toDir(m[1]!))
    }
  }
  return dirs
}

/** beforeModelCall middleware — discovers context files in directories the agent touches. */
export function createDiscoveryMiddleware(
  patterns: string[], root: string, initialPaths: Set<string>,
): Middleware<ModelCallContext> {
  const seen = new Set(initialPaths)
  const checked = new Set<string>()
  let cursor = 0

  return async (ctx: ModelCallContext) => {
    const messages = ctx.request.messages
    const dirs = extractDirs(messages, cursor)
    cursor = messages.length

    const newDirs = [...dirs].filter(d => !checked.has(d))
    for (const d of newDirs) checked.add(d)
    if (newDirs.length === 0) return

    const files = await scanDirs(newDirs, patterns, root, seen)
    if (files.length === 0) return
    for (const f of files) seen.add(f.path)

    const msgs = buildContextMessages(files)
    let idx = 0
    for (let i = 0; i < messages.length; i++)
      if (typeof messages[i]!.content === 'string' && (messages[i]!.content as string).includes('<context-file '))
        idx = i + 1
    messages.splice(idx, 0, ...msgs)
    cursor += msgs.length
  }
}
