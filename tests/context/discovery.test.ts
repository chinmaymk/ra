import { describe, it, expect } from 'bun:test'
import type { ContextConfig, ContextFile } from '../../src/context/types'

describe('context types', () => {
  it('ContextConfig has expected shape', () => {
    const config: ContextConfig = {
      enabled: true,
      patterns: ['CLAUDE.md', '.cursorrules'],
    }
    expect(config.enabled).toBe(true)
    expect(config.patterns).toHaveLength(2)
  })

  it('ContextFile has expected shape', () => {
    const file: ContextFile = {
      path: '/project/CLAUDE.md',
      relativePath: 'CLAUDE.md',
      content: '# Instructions',
    }
    expect(file.path).toBe('/project/CLAUDE.md')
  })
})
