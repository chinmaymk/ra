import { join, isAbsolute, basename, normalize, sep } from 'path'
import { homedir } from 'os'

/**
 * Resolve a user-provided path (absolute, relative, or ~/home-relative) against cwd.
 */
export function resolvePath(path: string, cwd: string): string {
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  if (isAbsolute(path)) return path
  return join(cwd, path)
}

/**
 * Check if a string looks like a file path (absolute, relative, or home-relative).
 * Works cross-platform — handles both `/` and `\` absolute paths (Windows drive letters).
 */
export function looksLikePath(s: string): boolean {
  return s.startsWith('./') || s.startsWith('../') || s.startsWith('~/') ||
    s.startsWith('.\\') || s.startsWith('..\\') || s.startsWith('~\\') ||
    isAbsolute(s) ||
    s.endsWith('.js') || s.endsWith('.ts')
}

/**
 * Normalize a glob result path to use OS-native separators.
 * Bun.Glob always returns forward-slash paths; this converts them for use with path.join etc.
 */
export function normalizeGlobPath(p: string): string {
  if (sep === '/') return p
  return p.replace(/\//g, sep)
}

/**
 * Extract the first path segment from a glob result (e.g. "foo/SKILL.md" → "foo").
 * Handles both forward and back slashes.
 */
export function firstSegment(relPath: string): string {
  return relPath.split(/[/\\]/)[0]!
}

/**
 * Extract the filename from a path, cross-platform.
 */
export function fileName(filePath: string): string {
  return basename(filePath)
}

export { isAbsolute, join, basename, normalize, sep }
