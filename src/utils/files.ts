import { mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { ContentPart } from '../providers/types'
import { getMimeType } from './mime'

/** Create parent directories for a file path. */
export async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
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
