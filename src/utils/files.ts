import type { ContentPart } from '../providers/types'
import { getMimeType } from './mime'

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
