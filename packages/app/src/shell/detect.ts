import { looksLikePath } from '../utils/paths'

/** File extensions treated as shell/script entries (auto-detected, no prefix needed). */
export const SHELL_EXTENSIONS = [
  '.sh', '.bash', '.zsh',           // Unix shells
  '.py', '.rb', '.pl', '.php',      // Scripting languages
  '.lua', '.r', '.R',               // Other languages
  '.bat', '.cmd', '.ps1',           // Windows
]

/** Returns true if the entry uses the explicit `shell:` prefix. */
export function hasShellPrefix(entry: string): boolean {
  return entry.startsWith('shell:')
}

/** Returns true if the entry is a file path with a known script extension. */
export function isShellPath(entry: string): boolean {
  return looksLikePath(entry, SHELL_EXTENSIONS) && SHELL_EXTENSIONS.some(ext => entry.endsWith(ext))
}

/** Returns true if the entry should be handled as a shell script (prefix or script extension). */
export function isShellEntry(entry: string): boolean {
  return hasShellPrefix(entry) || isShellPath(entry)
}
