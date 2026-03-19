import type { IMessage } from '@chinmaymk/ra'
import type { ContextFile } from './types'

export function buildContextMessages(files: ContextFile[]): IMessage[] {
  return files.map(file => ({
    role: 'user' as const,
    content: `<context-file path="${file.relativePath}">\n${file.content}\n</context-file>`,
  }))
}

/** Extract the file path from a context-file XML message. */
export function extractContextFilePath(msg: IMessage): string | undefined {
  const content = typeof msg.content === 'string' ? msg.content : ''
  const match = content.match(/<context-file path="([^"]+)"/)
  return match?.[1]
}
