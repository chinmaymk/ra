import type { ITool } from '../providers/types'
import type { MemoryStore } from './store'

export function memorySearchTool(store: MemoryStore): ITool {
  return {
    name: 'memory_search',
    description:
      'Search memories from past conversations. ' +
      'Use this to recall user preferences, project decisions, or prior context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text search query' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
    async execute(input: unknown) {
      const { query, limit } = input as { query: string; limit?: number }
      const results = store.search(query, limit ?? 10)
      if (results.length === 0) return 'No memories found.'
      return results.map(m =>
        `[${m.createdAt}${m.tags ? ` | ${m.tags}` : ''}] ${m.content}`,
      ).join('\n\n')
    },
  }
}

export function memorySaveTool(store: MemoryStore): ITool {
  return {
    name: 'memory_save',
    description:
      'Save information to memory for future conversations. ' +
      'Use when you notice user preferences, corrections, project decisions, or technical choices.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'What to remember (concise, self-contained)' },
        tags: { type: 'string', description: 'Comma-separated tags for categorization' },
      },
      required: ['content'],
    },
    async execute(input: unknown) {
      const { content, tags } = input as { content: string; tags?: string }
      store.save(content, tags ?? '')
      store.trim()
      return 'Saved.'
    },
  }
}

export function memoryForgetTool(store: MemoryStore): ITool {
  return {
    name: 'memory_forget',
    description:
      'Forget memories matching a search query. ' +
      'Use when the user says something is no longer true, outdated, or should be forgotten.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match memories to forget' },
        limit: { type: 'number', description: 'Max memories to delete (default: 10)' },
      },
      required: ['query'],
    },
    async execute(input: unknown) {
      const { query, limit } = input as { query: string; limit?: number }
      const deleted = store.forget(query, limit ?? 10)
      return deleted > 0 ? `Forgot ${deleted} memory(s).` : 'No matching memories found.'
    },
  }
}
