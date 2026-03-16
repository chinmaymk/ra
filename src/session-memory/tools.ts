import type { ITool } from '../providers/types'
import type { SessionMemoryStore } from './store'

export function sessionMemoryReadTool(store: SessionMemoryStore): ITool {
  return {
    name: 'session_memory_read',
    description:
      'Read from session memory — a key-value scratchpad that lasts for the entire conversation. ' +
      'Unlike your regular context which may be summarized as the conversation grows, entries in session memory ' +
      'are guaranteed to remain visible to you in every turn. ' +
      'Provide a key to read a specific entry, or omit the key to list all entries. ' +
      'Session memory is NOT persisted across sessions — it only exists for this conversation. ' +
      'For long-term memory that persists across sessions, use memory_save/memory_search instead.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key to look up. If omitted, returns all keys and their values.' },
      },
    },
    async execute(input: unknown) {
      const { key } = input as { key?: string }
      if (key) {
        const value = store.get(key)
        return value !== undefined ? value : `No entry found for key "${key}".`
      }
      const entries = store.entries()
      const keys = Object.keys(entries)
      if (keys.length === 0) return 'Session memory is empty.'
      return keys.map(k => `${k}: ${entries[k]}`).join('\n')
    },
  }
}

export function sessionMemoryWriteTool(store: SessionMemoryStore): ITool {
  return {
    name: 'session_memory_write',
    description:
      'Store a key-value pair in session memory — a scratchpad that lasts for the entire conversation. ' +
      'Entries written here are guaranteed to remain visible to you in every turn, even as older messages ' +
      'are summarized to save space. Use this to remember:\n' +
      '- Plans and multi-step strategies you are executing\n' +
      '- Important decisions and their rationale\n' +
      '- Task progress and status tracking\n' +
      '- Intermediate results you will need later\n' +
      '- Key facts extracted from earlier in the conversation\n' +
      'Writing to an existing key overwrites the previous value. ' +
      'Keep keys short and descriptive. Values can be any text (plain text, markdown, JSON, etc.). ' +
      'Session memory is NOT persisted across sessions — for long-term memory use memory_save instead.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'A short descriptive identifier for this entry. Examples: "plan", "task_progress", "architecture_decisions", "user_preferences".',
        },
        value: {
          type: 'string',
          description: 'The content to store. Can be plain text, structured markdown, JSON, or any format that helps you recall the information later.',
        },
      },
      required: ['key', 'value'],
    },
    async execute(input: unknown) {
      const { key, value } = input as { key: string; value: string }
      store.set(key, value)
      return `Stored "${key}" in session memory.`
    },
  }
}

export function sessionMemoryDeleteTool(store: SessionMemoryStore): ITool {
  return {
    name: 'session_memory_delete',
    description:
      'Remove an entry from session memory by key. Session memory is a key-value scratchpad that stays ' +
      'visible to you across the entire conversation. Delete entries when they are no longer needed — ' +
      'for example, when a plan step is fully completed, a temporary note has been acted on, or tracked ' +
      'state is outdated. Removing stale entries keeps the scratchpad clean and avoids cluttering your context.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key of the entry to remove from session memory.' },
      },
      required: ['key'],
    },
    async execute(input: unknown) {
      const { key } = input as { key: string }
      const deleted = store.delete(key)
      return deleted ? `Removed "${key}" from session memory.` : `Key "${key}" not found in session memory.`
    },
  }
}
