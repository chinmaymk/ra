import { join, isAbsolute } from 'path'
import { homedir } from 'os'

/**
 * Resolve a user-provided path (absolute, relative, or ~/home-relative) against cwd.
 */
export function resolvePath(path: string, cwd: string): string {
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  if (isAbsolute(path)) return path
  return join(cwd, path)
}
