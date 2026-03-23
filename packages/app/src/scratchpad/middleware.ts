import type { ModelCallContext, ContentPart } from '@chinmaymk/ra'
import type { ScratchpadStore } from './store'

const SCRATCHPAD_MARKER = '<scratchpad>'
const SCRATCHPAD_MARKER_END = '</scratchpad>'

/** Strip a `<scratchpad>…</scratchpad>` block from a string. Returns null if not found. */
function stripBlock(text: string): string | null {
  const start = text.indexOf(SCRATCHPAD_MARKER)
  if (start < 0) return null
  const end = text.indexOf(SCRATCHPAD_MARKER_END, start)
  if (end < 0) return null
  const before = text.slice(0, start).trimEnd()
  const after = text.slice(end + SCRATCHPAD_MARKER_END.length).trimStart()
  return before + (after ? '\n\n' + after : '')
}

/**
 * Creates a beforeModelCall middleware that injects the current scratchpad
 * state into the message list. Runs after compaction so the state is always
 * present regardless of how many messages have been summarized.
 *
 * The scratchpad is appended near the tail of the message list (just before
 * the final user turn) rather than at the top. This keeps the long prefix
 * (system prompt + context files + conversation history) byte-identical
 * across turns, maximizing provider prompt-cache hit rates.
 *
 * All previously injected scratchpad blocks are stripped first so stale
 * copies never accumulate — even when compaction merges messages.
 */
export function createScratchpadMiddleware(store: ScratchpadStore) {
  return async (ctx: ModelCallContext): Promise<void> => {
    if (store.size() === 0) return

    const messages = ctx.request.messages

    // Strip ALL previously injected scratchpad blocks (iterate backward so
    // splice indices stay valid).
    for (let i = messages.length - 1; i >= 0; i--) {
      const content = messages[i]?.content

      if (typeof content === 'string') {
        const stripped = stripBlock(content)
        if (stripped === null) continue
        if (!stripped) { messages.splice(i, 1); continue }
        messages[i] = { ...messages[i] as typeof messages[number], content: stripped }
        continue
      }

      if (!Array.isArray(content)) continue
      const partIdx = (content as ContentPart[]).findIndex(
        p => p.type === 'text' && (p as { type: 'text'; text: string }).text.includes(SCRATCHPAD_MARKER),
      )
      if (partIdx < 0) continue
      const part = content[partIdx] as { type: 'text'; text: string }
      const stripped = stripBlock(part.text)
      if (stripped === null) continue
      const newParts = !stripped
        ? content.filter((_, idx) => idx !== partIdx)
        : content.map((p, idx) => idx === partIdx ? { type: 'text' as const, text: stripped } : p)
      messages[i] = { ...messages[i] as typeof messages[number], content: newParts }
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

    // Append as the final message so the scratchpad is the last thing the model
    // sees before generating. This keeps the entire prefix byte-identical across
    // turns, maximizing provider prompt-cache hit rates.
    messages.push({ role: 'user', content: block })
  }
}
