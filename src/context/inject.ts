import type { IMessage } from '../providers/types'
import type { ContextFile } from './types'

export function buildContextMessages(files: ContextFile[]): IMessage[] {
  return files.map(file => ({
    role: 'user' as const,
    content: `<context-file path="${file.relativePath}">\n${file.content}\n</context-file>`,
  }))
}
