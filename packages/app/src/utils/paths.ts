import { join, isAbsolute, basename, normalize, sep, resolve } from 'path'
import { homedir } from 'os'

/**
 * Cross-platform home directory.
 */
export function homeDir(): string {
  return homedir()
}

/** Global ra directory — user-wide config and recipes: ~/.ra */
export function globalRaDir(): string {
  return join(homedir(), '.ra')
}

/** Local ra data directory — project-specific data.
 *  Uses RA_DATA_DIR env var if set, otherwise .ra relative to cwd. */
export function localRaDir(): string {
  const envDir = process.env.RA_DATA_DIR
  if (envDir) return isAbsolute(envDir) ? envDir : join(process.cwd(), envDir)
  return join(process.cwd(), '.ra')
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

export { isAbsolute, join, basename, normalize, sep, resolve }
