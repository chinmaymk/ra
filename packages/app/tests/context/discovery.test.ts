import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import type { ContextConfig, ContextFile } from '../../src/context/types'
import { discoverContextFiles } from '../../src/context/discovery'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('context types', () => {
  it('ContextConfig has expected shape', () => {
    const config: ContextConfig = {
      enabled: true,
      patterns: ['CLAUDE.md', '.cursorrules'],
      resolvers: [],
      subdirectoryWalk: true,
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

describe('discoverContextFiles', () => {
  let tmp: string

  beforeEach(() => {
    tmp = join(tmpdir(), `ra-context-test-${Date.now()}`)
    mkdirSync(tmp, { recursive: true })
    Bun.spawnSync(['git', 'init'], { cwd: tmp })
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns empty array when no patterns match', async () => {
    const files = await discoverContextFiles({ cwd: tmp, patterns: ['CLAUDE.md'] })
    expect(files).toEqual([])
  })

  it('finds a file in cwd', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), '# Instructions')
    const files = await discoverContextFiles({ cwd: tmp, patterns: ['CLAUDE.md'] })
    expect(files).toHaveLength(1)
    expect(files[0]!.relativePath).toBe('CLAUDE.md')
    expect(files[0]!.content).toBe('# Instructions')
  })

  it('finds files in parent directories up to git root', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'root instructions')
    const sub = join(tmp, 'src', 'app')
    mkdirSync(sub, { recursive: true })
    const files = await discoverContextFiles({ cwd: sub, patterns: ['CLAUDE.md'] })
    expect(files).toHaveLength(1)
    expect(files[0]!.content).toBe('root instructions')
  })

  it('finds files at multiple levels', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'root')
    const sub = join(tmp, 'src')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'CLAUDE.md'), 'src level')
    const files = await discoverContextFiles({ cwd: sub, patterns: ['CLAUDE.md'] })
    expect(files).toHaveLength(2)
    expect(files[0]!.content).toBe('src level')
    expect(files[1]!.content).toBe('root')
  })

  it('supports glob patterns like .cursor/rules/*', async () => {
    const rulesDir = join(tmp, '.cursor', 'rules')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(join(rulesDir, 'typescript.mdc'), 'ts rules')
    writeFileSync(join(rulesDir, 'testing.mdc'), 'test rules')
    const files = await discoverContextFiles({ cwd: tmp, patterns: ['.cursor/rules/*'] })
    expect(files).toHaveLength(2)
  })

  it('returns empty when no patterns given', async () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), 'instructions')
    const files = await discoverContextFiles({ cwd: tmp, patterns: [] })
    expect(files).toEqual([])
  })
})
