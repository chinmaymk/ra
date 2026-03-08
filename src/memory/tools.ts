import type { ITool } from '../providers/types'
import type { MemoryStore } from './store'

export function memorySearchTool(store: MemoryStore): ITool {
  return {
    name: 'memory_search',
    description:
      'Search persistent memories by keyword. ' +
      'Recent memories are automatically recalled at conversation start — ' +
      'use this for targeted lookups when you need specific context not in the recalled set.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Full-text search query (single keywords work best)' },
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
      'Save a fact to persistent memory for future conversations. ' +
      'Proactively save when you learn: user preferences (tools, style, conventions), ' +
      'project decisions (tech stack, architecture), corrections ("actually we use X not Y"), ' +
      'or key context (team, deployment, constraints). ' +
      'To update an existing memory, use memory_forget to remove the old version first, then save the new one.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Self-contained fact to remember, e.g. "User prefers tabs over spaces"' },
        tags: { type: 'string', description: 'Category tag: preference, project, convention, team, or tooling' },
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
      'Delete memories matching a search query. Use when: ' +
      'the user corrects previous information, a fact becomes outdated, ' +
      'or before saving an updated version of an existing memory.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match memories to delete (single keywords work best)' },
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
