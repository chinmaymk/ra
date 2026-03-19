import type { ContentPart } from '@chinmaymk/ra'
import { getMimeType } from './mime'

/** Parse a JSONL file into an array of typed objects. Returns [] if file doesn't exist. */
export async function parseJsonlFile<T = unknown>(path: string): Promise<T[]> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  const text = await file.text()
  return text
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) as T } catch { return null } })
    .filter((v): v is T => v !== null)
}

export async function fileToContentPart(filePath: string): Promise<ContentPart> {
  const data = await Bun.file(filePath).bytes()
  const mimeType = getMimeType(filePath)
  if (mimeType.startsWith('image/')) {
    return {
      type: 'image',
      source: { type: 'base64', mediaType: mimeType, data: Buffer.from(data).toString('base64') },
    }
  }
  if (mimeType.startsWith('text/')) {
    return { type: 'text', text: Buffer.from(data).toString('utf-8') }
  }
  return { type: 'file', mimeType, data }
}
