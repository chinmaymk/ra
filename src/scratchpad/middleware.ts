import type { ModelCallContext } from '../agent/types'
import type { ScratchpadStore } from './store'

const SCRATCHPAD_MARKER = '<scratchpad>'
const SCRATCHPAD_MARKER_END = '</scratchpad>'

/**
 * Creates a beforeModelCall middleware that injects the current scratchpad
 * state into the message list. Runs after compaction so the state is always
 * present regardless of how many messages have been summarized.
 *
 * The middleware removes any previously injected scratchpad message and
 * re-injects the latest snapshot, keeping the context fresh each turn.
 */
export function createScratchpadMiddleware(store: ScratchpadStore) {
  return async (ctx: ModelCallContext): Promise<void> => {
    if (store.size() === 0) return

    const messages = ctx.request.messages

    // Remove any previously injected scratchpad message.
    // Check for both standalone scratchpad messages and scratchpad content
    // embedded inside another message (e.g. after context compaction merges
    // consecutive user messages together).
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = messages[i]!.content
      if (typeof content === 'string') {
        if (content.startsWith(SCRATCHPAD_MARKER)) {
          messages.splice(i, 1)
          break
        }
        // Handle scratchpad embedded inside a larger message (e.g. after compaction merge)
        const markerIdx = content.indexOf(SCRATCHPAD_MARKER)
        if (markerIdx >= 0) {
          const endIdx = content.indexOf(SCRATCHPAD_MARKER_END, markerIdx)
          if (endIdx >= 0) {
            const before = content.slice(0, markerIdx).trimEnd()
            const after = content.slice(endIdx + SCRATCHPAD_MARKER_END.length).trimStart()
            messages[i] = { ...messages[i]!, content: before + (after ? '\n\n' + after : '') }
            break
          }
        }
      }
    }

    // Build the scratchpad block
    const entries = store.entries()
    const lines = Object.entries(entries).map(
      ([key, value]) => `### ${key}\n${value}`,
    )

    const block =
      `${SCRATCHPAD_MARKER}\n` +
      'Below are entries you previously saved to the scratchpad during this conversation. ' +
      'These entries are guaranteed to remain visible to you even as older messages are summarized. ' +
      'You can update entries with scratchpad_write or remove them with scratchpad_delete.\n\n' +
      lines.join('\n\n') +
      `\n${SCRATCHPAD_MARKER_END}`

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
