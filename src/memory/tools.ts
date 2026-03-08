import type { ITool } from '../providers/types'
import type { MemoryStore } from './store'

export function memorySearchTool(store: MemoryStore): ITool {
  return {
    name: 'memory_search',
    description:
      'Search memories for relevant information from past conversations. ' +
      'Uses full-text search across session and long-term memory layers. ' +
      'PROACTIVELY search at the start of tasks to check for relevant prior context — ' +
      'user preferences, project conventions, or past decisions that should inform your approach.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (supports full-text search: AND, OR, NOT, "exact phrase", prefix*)' },
        limit: { type: 'number', description: 'Max results to return (default: 10)' },
        layer: { type: 'string', enum: ['session', 'long-term'], description: 'Filter by memory layer. Omit to search all layers.' },
      },
      required: ['query'],
    },
    async execute(input: unknown) {
      const { query, limit, layer } = input as { query: string; limit?: number; layer?: 'session' | 'long-term' }
      const results = store.search(query, { limit: limit ?? 10, layer })
      if (results.length === 0) return 'No memories found matching that query.'
      return results.map(m =>
        `[#${m.id} | ${m.layer} | ${m.createdAt}${m.tags ? ` | ${m.tags}` : ''}]\n${m.content}`,
      ).join('\n\n')
    },
  }
}

export function memorySaveTool(store: MemoryStore): ITool {
  return {
    name: 'memory_save',
    description:
      'Save important information to memory for future reference. ' +
      'PROACTIVELY save when you notice user preferences, corrections, project decisions, or technical choices — ' +
      'don\'t wait to be asked. Memories default to the session layer. ' +
      'Only use layer="long-term" for facts that have proven importance across conversations. ' +
      'Keep content concise and self-contained.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The information to remember' },
        tags: { type: 'string', description: 'Comma-separated tags (e.g. "preference,editor,setup")' },
        layer: { type: 'string', enum: ['session', 'long-term'], description: 'Memory layer (default: session). Use long-term only for proven, durable facts.' },
      },
      required: ['content'],
    },
    async execute(input: unknown) {
      const { content, tags, layer } = input as { content: string; tags?: string; layer?: 'session' | 'long-term' }
      const memory = store.save(content, { tags: tags ?? '', layer: layer ?? 'session' })
      store.enforceMaxSize()
      return `Memory saved (id: ${memory.id}, layer: ${memory.layer}).`
    },
  }
}

export function memoryDeleteTool(store: MemoryStore): ITool {
  return {
    name: 'memory_delete',
    description: 'Delete a specific memory by its ID. Use memory_search first to find the ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'The memory ID to delete' },
      },
      required: ['id'],
    },
    async execute(input: unknown) {
      const { id } = input as { id: number }
      return store.delete(id) ? `Memory #${id} deleted.` : `Memory #${id} not found.`
    },
  }
}
