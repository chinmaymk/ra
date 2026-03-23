import { join, isAbsolute, basename, normalize, sep, resolve } from 'path'
import { homedir } from 'os'
import { createHash } from 'node:crypto'

/**
 * Cross-platform home directory.
 */
export function homeDir(): string {
  return homedir()
}

/**
 * Resolve a user-provided path (absolute, relative, or ~/home-relative) against cwd.
 * Handles both forward and back slashes for home-relative paths on Windows.
 */
export function resolvePath(filePath: string, cwd: string): string {
  if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
    return join(homedir(), filePath.slice(2))
  }
  if (isAbsolute(filePath)) return filePath
  return join(cwd, filePath)
}

/**
 * Check if a string looks like a file path (absolute, relative, or home-relative).
 * Works cross-platform — handles both `/` and `\` absolute paths (Windows drive letters).
 * Optionally pass extra extensions (e.g. '.txt', '.md') to also detect those as paths.
 */
export function looksLikePath(s: string, extraExtensions?: string[]): boolean {
  if (
    s.startsWith('./') || s.startsWith('../') || s.startsWith('~/') ||
    s.startsWith('.\\') || s.startsWith('..\\') || s.startsWith('~\\') ||
    isAbsolute(s) ||
    s.endsWith('.js') || s.endsWith('.ts')
  ) return true
  if (extraExtensions) {
    return extraExtensions.some(ext => s.endsWith(ext))
  }
  return false
}

/**
 * Extract the first path segment from a glob result (e.g. "foo/SKILL.md" → "foo").
 * Handles both forward and back slashes.
 */
export function firstSegment(relPath: string): string {
  return relPath.split(/[/\\]/)[0] ?? ''
}

/**
 * Deterministic, human-readable handle for a config directory.
 * Format: `{basename}-{hash8}` where hash8 is the first 8 hex chars of
 * SHA-256 of the normalized absolute path.  Used to namespace centralized
 * data (sessions, memory) under ~/.ra/.
 */
export function configHandle(configDir: string): string {
  const normalized = normalize(configDir)
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 8)
  const name = basename(normalized) || 'root'
  return `${name}-${hash}`
}

export { isAbsolute, join, basename, normalize, sep, resolve }
