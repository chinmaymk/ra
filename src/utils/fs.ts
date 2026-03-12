import { access, readFile, writeFile } from 'node:fs/promises'

export async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

export async function readText(path: string): Promise<string> {
  return readFile(path, 'utf-8')
}

export async function readBytes(path: string): Promise<Uint8Array> {
  return readFile(path)
}

export { writeFile }
