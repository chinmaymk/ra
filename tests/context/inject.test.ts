import { describe, it, expect } from 'bun:test'
import { buildContextMessages } from '../../src/context/inject'
import type { ContextFile } from '../../src/context/types'

describe('buildContextMessages', () => {
  it('returns empty array for no files', () => {
    const messages = buildContextMessages([])
    expect(messages).toEqual([])
  })

  it('creates one user message per file', () => {
    const files: ContextFile[] = [
      { path: '/p/CLAUDE.md', relativePath: 'CLAUDE.md', content: '# Instructions' },
      { path: '/p/.cursorrules', relativePath: '.cursorrules', content: 'rules here' },
    ]
    const messages = buildContextMessages(files)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.role).toBe('user')
    expect(messages[1]!.role).toBe('user')
  })

  it('wraps content in context-file XML tags with path', () => {
    const files: ContextFile[] = [
      { path: '/p/CLAUDE.md', relativePath: 'CLAUDE.md', content: '# Be helpful' },
    ]
    const messages = buildContextMessages(files)
    expect(messages[0]!.content).toBe(
      '<context-file path="CLAUDE.md">\n# Be helpful\n</context-file>'
    )
  })
})
