import type { ITool } from '../providers/types'
import type { MemoryStore } from './store'

export function memorySearchTool(store: MemoryStore): ITool {
  return {
    name: 'memory_search',
    description:
      'Search long-term memory for relevant information from past conversations. ' +
      'Uses full-text search. Returns matching memories ranked by relevance. ' +
      'Use this to recall user preferences, past decisions, project context, or any previously stored knowledge.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (supports full-text search syntax: AND, OR, NOT, "exact phrase", prefix*)' },
        limit: { type: 'number', description: 'Max results to return (default: 10)' },
      },
      required: ['query'],
    },
    async execute(input: unknown) {
      const { query, limit } = input as { query: string; limit?: number }
      const results = store.search(query, limit ?? 10)
      if (results.length === 0) return 'No memories found matching that query.'
      return results.map(m =>
        `[#${m.id} | ${m.createdAt}${m.tags ? ` | ${m.tags}` : ''}]\n${m.content}`,
      ).join('\n\n')
    },
  }
}

export function memorySaveTool(store: MemoryStore): ITool {
  return {
    name: 'memory_save',
    description:
      'Save important information to long-term memory for future reference. ' +
      'Use this to remember user preferences, key decisions, project details, ' +
      'or anything that should persist across conversations. Add tags for categorization.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The information to remember' },
        tags: { type: 'string', description: 'Comma-separated tags for categorization (e.g. "preference,editor,setup")' },
      },
      required: ['content'],
    },
    async execute(input: unknown) {
      const { content, tags } = input as { content: string; tags?: string }
      const memory = store.save(content, tags ?? '')
      store.enforceMaxSize()
      return `Memory saved (id: ${memory.id}).`
    },
  }
}
