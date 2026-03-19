import type { ITool } from '@chinmaymk/ra'
import type { ScratchpadStore } from './store'

export function scratchpadWriteTool(store: ScratchpadStore): ITool {
  return {
    name: 'scratchpad_write',
    description:
      'Store a key-value pair in the scratchpad — a temporary notepad that lasts for this conversation only. ' +
      'Entries written here are guaranteed to remain visible to you in every turn, even as older messages ' +
      'are summarized to save space. Use this to remember:\n' +
      '- Task checklists and progress tracking (e.g. "- [x] step 1\\n- [ ] step 2\\n- [ ] step 3")\n' +
      '- Plans and multi-step strategies you are executing\n' +
      '- Important decisions and their rationale\n' +
      '- Intermediate results you will need later\n' +
      '- Key facts extracted from earlier in the conversation\n' +
      'Writing to an existing key overwrites the previous value — use this to update checklists ' +
      'as you complete steps. Keep keys short and descriptive. Values can be any text (plain text, markdown, JSON, etc.). ' +
      'The scratchpad is NOT persisted across sessions — for long-term memory use memory_save instead.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'A short descriptive identifier for this entry. Examples: "checklist", "plan", "task_progress", "architecture_decisions", "user_preferences".',
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
      return `Stored "${key}" in scratchpad.`
    },
  }
}

export function scratchpadDeleteTool(store: ScratchpadStore): ITool {
  return {
    name: 'scratchpad_delete',
    description:
      'Remove an entry from the scratchpad by key. The scratchpad is a temporary key-value notepad that stays ' +
      'visible to you across the entire conversation. Delete entries when they are no longer needed — ' +
      'for example, when a plan step is fully completed, a temporary note has been acted on, or tracked ' +
      'state is outdated. Removing stale entries keeps the scratchpad clean and avoids cluttering your context.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'The key of the entry to remove from the scratchpad.' },
      },
      required: ['key'],
    },
    async execute(input: unknown) {
      const { key } = input as { key: string }
      const deleted = store.delete(key)
      return deleted ? `Removed "${key}" from scratchpad.` : `Key "${key}" not found in scratchpad.`
    },
  }
}
