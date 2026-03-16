import type { ITool } from '../providers/types'
import type { SessionMemoryStore } from './store'

export function sessionMemoryReadTool(store: SessionMemoryStore): ITool {
  return {
    name: 'session_memory_read',
    description:
      'Read a value from session memory by key, or list all keys if no key is provided. ' +
      'Session memory is an ephemeral scratchpad that persists across context compactions within this session. ' +
      'Use it to recall plans, decisions, tracked state, or anything you stored earlier.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to read. Omit to list all keys and values.' },
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
      'Write a key-value pair to session memory. ' +
      'Use this to persist plans, decisions, task progress, intermediate results, or any state ' +
      'you want to survive context compaction. Overwrites existing values for the same key. ' +
      'Keep keys short and descriptive (e.g. "plan", "decisions", "progress").',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short descriptive key, e.g. "plan", "current_task", "decisions"' },
        value: { type: 'string', description: 'Value to store. Can be any text — structured notes, JSON, markdown, etc.' },
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
      'Remove a key from session memory when it is no longer relevant. ' +
      'Keeping session memory tidy improves context quality.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to remove' },
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
