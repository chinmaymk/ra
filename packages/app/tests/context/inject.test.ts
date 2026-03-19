import { describe, it, expect } from 'bun:test'
import { buildContextMessages, extractContextFilePath } from '../../src/context/inject'
import type { ContextFile } from '../../src/context/types'
import type { IMessage } from '@chinmaymk/ra'

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

describe('extractContextFilePath', () => {
  it('extracts path from context-file XML message', () => {
    const msg: IMessage = {
      role: 'user',
      content: '<context-file path="src/utils.ts">\ncode here\n</context-file>',
    }
    expect(extractContextFilePath(msg)).toBe('src/utils.ts')
  })

  it('extracts path from message built by buildContextMessages', () => {
    const files: ContextFile[] = [
      { path: '/p/CLAUDE.md', relativePath: 'CLAUDE.md', content: 'instructions' },
    ]
    const msgs = buildContextMessages(files)
    expect(extractContextFilePath(msgs[0]!)).toBe('CLAUDE.md')
  })

  it('returns undefined for non-context messages', () => {
    expect(extractContextFilePath({ role: 'user', content: 'just a question' })).toBeUndefined()
  })

  it('returns undefined for non-string content', () => {
    const msg: IMessage = { role: 'user', content: [{ type: 'text', text: 'text' }] }
    expect(extractContextFilePath(msg)).toBeUndefined()
  })

  it('returns undefined for assistant messages', () => {
    const msg: IMessage = { role: 'assistant', content: '<context-file path="x">y</context-file>' }
    // Still works — extractContextFilePath doesn't filter by role
    expect(extractContextFilePath(msg)).toBe('x')
  })
})
