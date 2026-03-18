import { resolve } from 'path'

/** Ensure a file path is within the allowed root directory. Throws if not. */
export function assertWithinRoot(filePath: string, rootDir: string): void {
  const abs = resolve(filePath)
  const root = resolve(rootDir)
  if (!abs.startsWith(root + '/') && abs !== root) {
    throw new Error(`Path "${filePath}" is outside the allowed root directory "${rootDir}"`)
  }
}
