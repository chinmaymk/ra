import type { ModelCallContext } from '../agent/types'
import type { SessionMemoryStore } from './store'

const SESSION_MEMORY_MARKER = '<session-memory>'
const SESSION_MEMORY_MARKER_END = '</session-memory>'

/**
 * Creates a beforeModelCall middleware that injects the current session memory
 * state into the message list. Runs after compaction so the state is always
 * present regardless of how many messages have been summarized.
 *
 * The middleware removes any previously injected session-memory message and
 * re-injects the latest snapshot, keeping the context fresh each turn.
 */
export function createSessionMemoryMiddleware(store: SessionMemoryStore) {
  return async (ctx: ModelCallContext): Promise<void> => {
    if (store.size() === 0) return

    const messages = ctx.request.messages

    // Remove any previously injected session-memory message
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = messages[i]!.content
      if (
        typeof content === 'string' &&
        content.startsWith(SESSION_MEMORY_MARKER)
      ) {
        messages.splice(i, 1)
        break
      }
    }

    // Build the session memory block
    const entries = store.entries()
    const lines = Object.entries(entries).map(
      ([key, value]) => `### ${key}\n${value}`,
    )

    const block =
      `${SESSION_MEMORY_MARKER}\n` +
      'Below are entries you previously saved to session memory during this conversation. ' +
      'These entries are guaranteed to remain visible to you even as older messages are summarized. ' +
      'You can update entries with session_memory_write or remove them with session_memory_delete.\n\n' +
      lines.join('\n\n') +
      `\n${SESSION_MEMORY_MARKER_END}`

    // Inject after all system messages and the first user message (the pinned zone)
    // so it sits right before the conversation history.
    let insertIdx = 0
    for (let i = 0; i < messages.length; i++) {
      insertIdx = i + 1
      if (messages[i]!.role === 'user') break
    }

    messages.splice(insertIdx, 0, { role: 'user', content: block })
  }
}
