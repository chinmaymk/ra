import type { IMessage } from '../providers/types'

/**
 * A memory extractor takes conversation messages and returns
 * extracted memories (content + optional tags).
 */
export interface MemoryExtractor {
  extract(messages: IMessage[]): MemoryEntry[]
}

export interface MemoryEntry {
  content: string
  tags: string
}

/**
 * Default extractor: looks for assistant messages that contain
 * explicit memory markers like [REMEMBER: ...] or user corrections.
 * Also extracts key facts from tool results that resolve user questions.
 */
export class DefaultMemoryExtractor implements MemoryExtractor {
  private static REMEMBER_RE = /\[REMEMBER:\s*(.+?)\]/gi

  extract(messages: IMessage[]): MemoryEntry[] {
    const entries: MemoryEntry[] = []

    for (const msg of messages) {
      const text = typeof msg.content === 'string' ? msg.content : ''
      if (!text) continue

      // Extract explicit [REMEMBER: ...] markers from any role
      let match: RegExpExecArray | null
      const re = new RegExp(DefaultMemoryExtractor.REMEMBER_RE.source, 'gi')
      while ((match = re.exec(text)) !== null) {
        entries.push({ content: match[1]!.trim(), tags: 'explicit' })
      }

      // Extract user preferences/corrections — short user messages that
      // start with corrective phrases
      if (msg.role === 'user' && text.length < 500) {
        const lower = text.toLowerCase()
        const corrective = [
          'actually', 'no,', 'wrong', 'instead', 'i prefer',
          'always use', 'never use', 'remember that', 'don\'t forget',
          'keep in mind', 'my name is', 'i use', 'i work with',
        ]
        if (corrective.some(p => lower.startsWith(p) || lower.includes(p))) {
          entries.push({ content: text, tags: 'user-preference' })
        }
      }
    }

    return entries
  }
}
