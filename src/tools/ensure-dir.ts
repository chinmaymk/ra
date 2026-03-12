import { mkdir } from 'fs/promises'
import { dirname } from 'path'

/** Create parent directories for the given file path. */
export async function ensureDir(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
}
