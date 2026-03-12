import { dirname, isAbsolute, resolve } from 'path'
import type { ModelCallContext, Middleware } from '../agent/types'
import type { IMessage } from '../providers/types'
import { discoverContextInDirs } from './discovery'
import { buildContextMessages } from './inject'

export interface DiscoveryMiddlewareOptions {
  /** Glob patterns to match context files (e.g. CLAUDE.md, .cursorrules) */
  patterns: string[]
  /** Git root (or project root) for computing relative paths */
  gitRoot: string
  /** Absolute paths of context files already injected at bootstrap */
  initialPaths: Set<string>
}

/** Absolute path regex — must start with / */
const ABS_PATH_RE = /(?:^|[\s"'=:])(\/.+?)(?=[\s"',)\]}>]|$)/g

/**
 * Extract directory paths from tool call arguments and tool results
 * in the message list, starting from `startIdx`.
 */
function extractDirsFromMessages(messages: IMessage[], startIdx: number, gitRoot: string): Set<string> {
  const dirs = new Set<string>()

  for (let i = startIdx; i < messages.length; i++) {
    const msg = messages[i]!

    // Tool call arguments — structured JSON with path-like fields
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      for (const tc of msg.toolCalls) {
        try {
          const args = JSON.parse(tc.arguments || '{}')
          for (const key of Object.keys(args)) {
            const val = args[key]
            if (typeof val === 'string' && isAbsolute(val)) {
              const dir = looksLikeFile(val) ? dirname(val) : val
              if (dir.startsWith(gitRoot)) dirs.add(dir)
            }
          }
        } catch {
          // Not valid JSON — skip
        }
      }
    }

    // Tool results — scan content for absolute paths
    if (msg.role === 'tool' && typeof msg.content === 'string') {
      ABS_PATH_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = ABS_PATH_RE.exec(msg.content)) !== null) {
        const p = match[1]!
        const dir = looksLikeFile(p) ? dirname(p) : p
        if (dir.startsWith(gitRoot)) dirs.add(dir)
      }
    }
  }

  return dirs
}

/** Heuristic: does the path look like a file (has an extension or no trailing slash)? */
function looksLikeFile(p: string): boolean {
  if (p.endsWith('/')) return false
  const base = p.slice(p.lastIndexOf('/') + 1)
  return base.includes('.')
}

/**
 * Creates a beforeModelCall middleware that discovers context files
 * in directories the agent is actively working in.
 *
 * On each model call it:
 * 1. Scans new messages (since last check) for file paths from tool interactions
 * 2. Identifies directories not yet checked
 * 3. Discovers context files in those directories
 * 4. Injects new context files as user messages after the initial context block
 */
export function createDiscoveryMiddleware(
  opts: DiscoveryMiddlewareOptions,
): Middleware<ModelCallContext> {
  const seenPaths = new Set(opts.initialPaths)
  const checkedDirs = new Set<string>()
  let lastScannedIdx = 0

  return async (ctx: ModelCallContext) => {
    const messages = ctx.request.messages

    // Extract dirs from messages we haven't scanned yet
    const dirs = extractDirsFromMessages(messages, lastScannedIdx, opts.gitRoot)
    lastScannedIdx = messages.length

    // Filter to dirs we haven't checked
    const newDirs: string[] = []
    for (const dir of dirs) {
      if (!checkedDirs.has(dir)) {
        checkedDirs.add(dir)
        newDirs.push(dir)
      }
    }
    if (newDirs.length === 0) return

    // Discover context files in those directories
    const newFiles = await discoverContextInDirs(newDirs, opts.patterns, opts.gitRoot, seenPaths)
    if (newFiles.length === 0) return

    // Track newly discovered files
    for (const f of newFiles) seenPaths.add(f.path)

    // Inject as user messages after the last existing context-file message
    const contextMsgs = buildContextMessages(newFiles)
    let insertIdx = 0
    for (let i = 0; i < messages.length; i++) {
      const content = typeof messages[i]!.content === 'string' ? messages[i]!.content : ''
      if (content.includes('<context-file ')) insertIdx = i + 1
    }
    messages.splice(insertIdx, 0, ...contextMsgs)
    // Shift our scan index to account for inserted messages
    lastScannedIdx += contextMsgs.length
  }
}
