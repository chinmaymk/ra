import { resolve } from 'path'
import { realpathSync } from 'fs'

/** Ensure a file path is within the allowed root directory. Follows symlinks. Throws if not. */
export function assertWithinRoot(filePath: string, rootDir: string): void {
  const root = realpathSync(resolve(rootDir))
  let abs: string
  try {
    abs = realpathSync(resolve(filePath))
  } catch {
    // File doesn't exist yet (e.g. Write) — fall back to string-based check
    abs = resolve(filePath)
  }
  if (!abs.startsWith(root + '/') && abs !== root) {
    throw new Error(`Path "${filePath}" is outside the allowed root directory "${rootDir}"`)
  }
}
